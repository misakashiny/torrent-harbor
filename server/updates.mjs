import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function versionParts(tag) {
  const match=String(tag).match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if(!match) throw new Error('版本号格式不受支持');
  return [Number(match[1]),Number(match[2]),Number(match[3]),match[4]||''];
}
export function isNewer(next,current) {
  const a=versionParts(next),b=versionParts(current);
  for(let i=0;i<3;i++) if(a[i]!==b[i]) return a[i]>b[i];
  if(!a[3]&&b[3]) return true;
  if(a[3]&&!b[3]) return false;
  return a[3].localeCompare(b[3],undefined,{numeric:true})>0;
}
export function repositoryName(value) {
  const text=String(value||'').trim().replace(/^https:\/\/github\.com\//,'').replace(/\.git\/?$/,'').replace(/\/$/,'');
  if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(text)) throw new Error('仓库格式应为 owner/repository');
  return text;
}
function fileJson(file,fallback=null) { try { return JSON.parse(readFileSync(file,'utf8')); } catch { return fallback; } }
export class UpdateManager {
  constructor(store,{version,directory,fetcher=fetch,platform=process.arch==='arm64'?'linux-arm64':'linux-amd64'}={}) {
    this.store=store;this.version=version;this.directory=directory;this.fetcher=fetcher;this.platform=platform;this.checking=false;
    if(!store.get('updates')) store.set('updates',{repository:'misakashiny/torrent-harbor',autoCheck:false,lastChecked:null,latest:null,error:''});
  }
  status() {
    const config=this.store.get('updates');
    const agent=this.directory?fileJson(join(this.directory,'agent.json')):null;
    let job=this.directory?fileJson(join(this.directory,'status.json')):null;
    const request=this.directory?fileJson(join(this.directory,'request.json')):null;
    if(request&&request.id!==job?.id&&Date.now()-request.requestedAt<600000) job={...request,state:'queued',message:'等待主机执行器接收'};
    const age=agent?Date.now()-agent.heartbeat:Infinity;
    const fresh=agent&&age>=0&&age<30000;
    const pinned=fresh&&typeof agent.repository==='string'&&agent.repository.toLowerCase()===config.repository.toLowerCase();
    return {...config,version:this.version,platform:this.platform,hasToken:!!this.store.get('updatesToken'),available:config.latest?isNewer(config.latest.tag,this.version):false,agentConnected:!!fresh,canInstall:!!pinned&&!agent?.recoveryNeeded,agent:agent?{repository:agent.repository,previousVersion:agent.previousVersion||null,recoveryNeeded:!!agent.recoveryNeeded}:null,job};
  }
  configure(input) {
    if(this.checking) throw new Error('正在检查版本，请稍后修改来源');
    if(['queued','downloading','verifying','backing-up','installing','checking','rolling-back'].includes(this.status().job?.state)) throw new Error('版本操作进行中，请稍后修改来源');
    const old=this.store.get('updates');
    const repo=repositoryName(input.repository??old.repository);
    const next={...old,repository:repo,autoCheck:Boolean(input.autoCheck??old.autoCheck),...(repo!==old.repository?{latest:null,lastChecked:null,error:''}:{})};
    if(input.token!==undefined) {
      if(typeof input.token!=='string'||input.token.length>512) throw new Error('读取令牌格式不正确');
      if(input.token) this.store.set('updatesToken',this.store.seal(input.token));
      if(input.clearToken) this.store.set('updatesToken','');
    }
    this.store.set('updates',next);return this.status();
  }
  async check() {
    if(this.checking) return this.status();
    this.checking=true;
    const config=this.store.get('updates');
    try {
      const headers={Accept:'application/vnd.github+json','User-Agent':'TorrentHarbor/'+this.version,'X-GitHub-Api-Version':'2026-03-10'};
      const token=this.store.get('updatesToken');if(token)headers.Authorization='Bearer '+this.store.unseal(token);
      let response;
      for(let attempt=0;attempt<3;attempt++) {
        try {
          response=await this.fetcher(`https://api.github.com/repos/${repositoryName(config.repository)}/releases/latest`,{headers,signal:AbortSignal.timeout(20000),redirect:'error'});
          if(response.status<500||attempt===2)break;
          await response.body?.cancel();
        } catch(error) { if(attempt===2)throw error; }
        await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
      }
      if(response.status===404) throw new Error('尚无正式发布版本，或私有仓库缺少读取权限');
      if(response.status===403||response.status===429) throw new Error('GitHub 请求受限，请稍后重试');
      if(!response.ok) throw new Error(`GitHub 检查失败（HTTP ${response.status}）`);
      const result=await response.json();versionParts(result.tag_name);
      if(result.draft||result.prerelease) throw new Error('更新源返回了非正式版本');
      const version=result.tag_name.replace(/^v/,'');
      const wanted=`torrent-harbor-${version}-${this.platform}.tar.gz`;
      const asset=result.assets?.find(a=>a.name===wanted);
      const checksum=result.assets?.find(a=>a.name===wanted+'.sha256');
      const latest={id:result.id,tag:result.tag_name,name:String(result.name||result.tag_name).slice(0,200),notes:String(result.body||'').slice(0,12000),url:`https://github.com/${config.repository}/releases/tag/${encodeURIComponent(result.tag_name)}`,publishedAt:result.published_at,assetReady:!!(asset&&checksum),assetSize:asset?.size||0,assetId:asset?.id||null};
      this.store.set('updates',{...config,latest,lastChecked:Date.now(),error:''});
    } catch(error) { this.store.set('updates',{...config,lastChecked:Date.now(),error:error.message}); }
    finally {this.checking=false;}
    return this.status();
  }
  assertIdle() {
    if(this.store.get('settings').controlEnabled || Object.keys(this.store.get('managed',{})).length) throw new Error('更新前请先释放接管，确认已恢复下载器设置');
    const state=this.status();if(state.agent?.recoveryNeeded)throw new Error('主机存在待恢复的版本操作，请检查更新服务日志');if(!state.canInstall) throw new Error(state.agentConnected?'仓库与主机更新执行器的固定来源不一致':'主机更新执行器未连接，请先按部署说明安装');
    if(state.job&&['queued','downloading','verifying','backing-up','installing','checking','rolling-back'].includes(state.job.state)) throw new Error('已有更新任务正在执行');
    return state;
  }
  plan(action='update') {
    const status=this.assertIdle();
    if(!['update','rollback'].includes(action)) throw new Error('更新操作无效');
    if(action==='update'&&(!status.latest?.assetReady||!status.available)) throw new Error('没有适合当前架构的更新安装包');
    if(action==='rollback'&&!status.agent.previousVersion) throw new Error('没有可回退的版本');
    const plan={id:randomUUID(),action,repository:status.repository,tag:action==='update'?status.latest.tag:'v'+status.agent.previousVersion,releaseId:action==='update'?status.latest.id:null,createdAt:Date.now(),expires:Date.now()+600000};
    this.store.set('updatePlan',plan);
    return {...plan,currentVersion:this.version,notes:action==='update'?status.latest.notes:'回退会恢复更新前的数据快照；更新后的配置变更也会回退。'};
  }
  queue(planId) {
    this.assertIdle();const plan=this.store.get('updatePlan');
    if(!plan||plan.id!==planId||plan.expires<Date.now()) throw new Error('更新预览已过期，请重新检查');
    const config=this.store.get('updates');if(plan.repository!==config.repository)throw new Error('更新来源已改变，请重新预览');
    mkdirSync(this.directory,{recursive:true});
    const job={id:randomUUID(),action:plan.action,repository:plan.repository,tag:plan.tag,releaseId:plan.releaseId,requestedAt:Date.now()};
    const temporary=join(this.directory,`request-${job.id}.tmp`);
    writeFileSync(temporary,JSON.stringify(job),{mode:0o600});renameSync(temporary,join(this.directory,'request.json'));
    this.store.set('updatePlan',null);this.store.event('版本操作已提交',`${job.action==='rollback'?'回退':'更新'} ${job.tag}`);
    return {jobId:job.id,tag:job.tag};
  }
  start() {
    this.timer=setInterval(()=>{const c=this.store.get('updates');if(c.autoCheck&&Date.now()-(c.lastChecked||0)>21600000)void this.check();},60000);this.timer.unref();
  }
  stop(){clearInterval(this.timer);}
}
