import { createAdapter } from './adapters.mjs';
import { DemoAdapter } from './demo.mjs';
import { buildPlan, sameLimit } from './engine.mjs';
import { ruleRevision } from './rule-order.mjs';
import { QuickActions, activeRuns, quickPolicy } from './quick-actions.mjs';
import { limitStatuses } from './limit-status.mjs';

export class Controller {
  constructor(store) { this.store = store; this.adapters = new Map(); this.runtime = new Map(); this.results = new Map(); this.limitOperations=new Map(); this.limitResults=new Map(); this.limitRevision=0; this.plan = []; this.lastControl = 0; this.lastSample = 0; this.busy = false; this.timer = null; this.error = ''; this.quickActions=new QuickActions(this); }
  operation(key,phase) { if(phase)this.limitOperations.set(key,{phase,since:Date.now()});else this.limitOperations.delete(key);this.limitRevision++; }
  issue(key,state,message) { this.limitResults.set(key,{state,message,time:Date.now()});this.limitRevision++; }
  clearIssue(key) { if(this.limitResults.delete(key))this.limitRevision++; }
  clients() { const mode = this.store.get('settings').mode; return this.store.get('clients',[]).filter(c => c.enabled && Boolean(c.demo) === (mode === 'demo')); }
  adapter(c) {
    const signature = JSON.stringify(c), cached = this.adapters.get(c.id);
    if (cached?.signature === signature) return cached.adapter;
    const adapter = c.demo ? new DemoAdapter(c) : createAdapter(c,this.store.unseal(c.password));
    if (c.demo) for (const rec of Object.values(this.store.get('managed',{})).filter(m=>m.clientId===c.id)) adapter.limits.set(rec.torrentId,{...(adapter.limits.get(rec.torrentId)||{upload:null,download:null}),[rec.direction]:rec.last});
    this.adapters.set(c.id,{signature,adapter}); return adapter;
  }
  async refresh(control = true) {
    if (this.busy) return false;
    this.busy = true;
    try {
      const clients = this.clients();
      for (let i=0;i<clients.length;i+=4) await Promise.all(clients.slice(i,i+4).map(async c => {
        const old = this.runtime.get(c.id);
        try {
          const snapshot = await this.adapter(c).snapshot();
          this.runtime.set(c.id,{...snapshot,online:true,time:Date.now(),error:''});
          this.store.traffic?.record(this.store.get('settings').mode,c,snapshot.traffic,Date.now(),Math.max(60000,this.store.get('settings').pollSeconds*3000));
          if (old && !old.online) this.store.event('下载器已重新连接',c.name,'success',{clientId:c.id,clientName:c.name,code:'client.reconnected'});
        } catch (e) {
          this.runtime.set(c.id,{...old,online:false,error:e.message,checked:Date.now()});
          this.store.logs?.write({level:'error',scope:'connection',code:'client.snapshot_failed',message:'下载器同步失败',context:{clientId:c.id,clientName:c.name,error:e.message,stack:e.stack}});
          if (!old || old.online) this.store.event('下载器连接异常',`${c.name}：${e.message}`,'warning',{clientId:c.id,clientName:c.name});
        }
      }));
      this.quickActions.expire();
      this.replan();
      const settings = this.store.get('settings');
      if (control && settings.controlEnabled && Date.now()-this.lastControl >= settings.controlSeconds*1000) {
        await this.apply(); this.lastControl = Date.now();
      }
      if (Date.now()-this.lastSample > 10000) {
        const online = clients.map(c => this.runtime.get(c.id)).filter(s=>s?.online);
        this.store.sample(online.reduce((s,c)=>s+c.upload,0),online.reduce((s,c)=>s+c.download,0),settings.mode); this.lastSample = Date.now();
      }
      this.error = '';
    } catch (e) { this.error = e.message; this.store.event('调度轮次失败',e.message,'error'); }
    finally { this.busy = false; }
    return true;
  }
  torrents() {
    const labels = this.store.get('labels',{});
    return this.clients().flatMap(c => {
      const rt = this.runtime.get(c.id); return (rt?.torrents || []).map(t => {
        const key = `${c.id}:${c.type === 'tr' && !c.demo ? t.hash || t.id:t.id}`;
        return {...t,key,clientId:c.id,clientName:c.name,clientType:c.type,demo:c.demo,online:Boolean(rt.online),updated:rt.time,nativeTags:t.tags,localTags:labels[key] || [],tags:[...new Set([...t.tags,...(labels[key] || [])])]};
      });
    });
  }
  replan() { this.plan = buildPlan(this.torrents(),this.store.get('rules',[]),this.store.get('pools',[]),this.store.get('settings'),this.store.get('overrides',{}),new Date(),quickPolicy(activeRuns(this.store))).map(p=>({...p,execution:this.results.get(p.key)||''})); }
  managedKey(key,dir) { return `${this.store.get('settings').mode}|${key}|${dir}`; }
  async apply() {
    this.plan.forEach(p=>{p.execution='';});
    const unsupported=this.plan.filter(p=>p.managed&&p.online).flatMap(p=>{
      const c=this.clients().find(c=>c.id===p.clientId),adapter=c&&this.adapter(c);
      return ['upload','download'].map(dir=>adapter?.limitProblem?.(p[dir])).filter(Boolean);
    });
    if(unsupported.length){
      const message=unsupported[0]+'；本轮限速计划未执行';
      for(const p of this.plan.filter(p=>p.managed)){p.execution=message;this.results.set(p.key,message);}
      if(this.lastUnsupported!==message)this.store.event('限速计划无法执行',message,'warning');
      this.lastUnsupported=message;return;
    }
    this.lastUnsupported='';
    const owned = this.store.get('managed',{}), mode = this.store.get('settings').mode, tasks = [], valid = new Set();
    const liveByKey = new Map(this.torrents().map(t=>[t.key,t])), planByKey = new Map(this.plan.map(p=>[p.key,p]));
    let blockIncrease = false;
    for (const p of this.plan.filter(p=>p.managed)) {
      const c = this.clients().find(c=>c.id===p.clientId); if (!c) continue;
      const adapter = this.adapter(c);
      for (const dir of ['upload','download']) {
        const key = this.managedKey(p.key,dir), target = adapter.quantize(p[dir]);
        if (target == null && p.quick?.[dir]?.kind!=='unlimited') continue;
        valid.add(key);
        if (!p.online || target != null && target <= 0) { blockIncrease = true; p.execution = target != null && target <= 0 ? '预算过小，拒绝写入零值':'失联，保留已分配额度'; continue; }
        try {
          const current = p[dir === 'upload' ? 'currentUpload':'currentDownload'], record = owned[key];
          if (record && (record.conflict || Object.hasOwn(record,'pending') || !sameLimit(current,record.last))) {
            const uncertain=Object.hasOwn(record,'pending');
            if (!record.conflict) {
              if(uncertain)this.store.event('上次限速写入未确认',`${p.name}：保留恢复记录，等待核对后重新接管`,'warning',{code:'limit.pending_recovery',clientId:c.id,torrentId:p.torrentId,direction:dir});
              else {record.issue='external';record.issueMessage='下载器当前值与上次回读确认值不同';record.issueTime=Date.now();this.store.event('检测到外部限速修改',`${p.name}：已保留外部值并停止接管该方向。可在详情中重新接管。`,'warning',{code:'limit.external_change',clientId:c.id,torrentId:p.torrentId,direction:dir});}
            }
            record.conflict = true; p.execution = record.issue==='failed'?'写入或回读失败，等待核对':uncertain?'上次写入未确认，等待核对':'外部修改或历史冲突，已让出控制'; blockIncrease = true; continue;
          }
          if (!sameLimit(current,target) || !record) tasks.push({key,p,dir,target,current,adapter,c,record});
          else p.execution='已回读确认（保持）';
        } catch (e) { blockIncrease = true; p.execution = e.message; }
      }
    }
    // Existing reservations on offline / hidden clients must not be silently reused.
    for (const [key,record] of Object.entries(owned).filter(([k])=>k.startsWith(`${mode}|`))) {
      const p = planByKey.get(record.key);
      const live = liveByKey.get(record.key);
      if (!p?.online || live?.metadataReady === false || record.conflict) blockIncrease = true;
    }
    const decreasing = tasks.filter(t=>t.target != null && (t.current == null || t.target <= t.current) || t.target == null && t.current == null);
    const increasing = tasks.filter(t=>t.current != null && (t.target == null || t.target > t.current));
    const execute = async task => {
      const {key,p,dir,target,current,adapter,c,record} = task;
      try {
        this.clearIssue(key);
        this.operation(key,'preparing');
        // Check again immediately before writing; native APIs do not provide compare-and-set.
        if (!sameLimit(await adapter.readLimit(p.torrentId,dir),current)) throw Object.assign(new Error('写入前值已变化，本轮跳过'),{limitIssue:'external'});
        // Persist intent before I/O so a process crash cannot lose the baseline.
        const baselineState=record?.baselineState || (!record && adapter.readLimitState ? await adapter.readLimitState(p.torrentId,dir):undefined);
        if(!record && baselineState && !sameLimit(baselineState.value,current)) throw Object.assign(new Error('备份原始限速时设置已变化，本轮跳过'),{limitIssue:'external'});
        owned[key] = {...record,mode,key:p.key,clientId:c.id,torrentId:p.torrentId,name:p.name,direction:dir,baseline:record ? record.baseline:current,baselineState,last:record ? record.last:current,pending:target,conflict:false};
        this.store.set('managed',owned);
        this.operation(key,'writing');
        await adapter.setLimit(p.torrentId,dir,target);
        this.operation(key,'confirming');
        const confirmed = await adapter.readLimit(p.torrentId,dir);
        if (!sameLimit(confirmed,target)) throw new Error('下载器回读值与目标不符');
        owned[key].last = confirmed; delete owned[key].pending; owned[key].time = Date.now();
        const rt = this.runtime.get(c.id)?.torrents.find(t=>String(t.id)===String(p.torrentId)); if (rt) rt[`${dir}Limit`] = confirmed;
        p.execution = '已回读确认';
        this.store.event('限速已确认',`${p.name} · ${dir === 'upload' ? '上传':'下载'} ${confirmed==null?'不限速':Math.round(confirmed/1024)+' KiB/s'}`, 'success',{code:'limit.confirmed',clientId:c.id,torrentId:p.torrentId,direction:dir,previous:current,target,confirmed});
        this.store.set('managed',owned); return true;
      } catch(e) {
        p.execution = e.message; blockIncrease = true;
        const external=e.limitIssue==='external';
        this.issue(key,external?'conflict':'failed',e.message);
        if (owned[key]) {
          // A failed response can still mean the remote write succeeded. Freeze the intent.
          owned[key].conflict = true;
          owned[key].issue=external?'external':'failed';owned[key].issueMessage=e.message;owned[key].issueTime=Date.now();
          this.store.set('managed',owned);
        }
        this.store.event(external?'检测到外部限速修改':'限速修改未确认',`${p.name}：${e.message}`,'warning',{code:external?'limit.external_change':'limit.unconfirmed',clientId:c.id,torrentId:p.torrentId,direction:dir,previous:current,target,error:e.message}); return false;
      } finally { this.operation(key,null); }
    };
    for (const task of decreasing) await execute(task);
    if (!blockIncrease) for (const task of increasing) { if (!await execute(task)) break; }
    else increasing.forEach(t=>{t.p.execution='有失联、外部修改或未确认额度，暂缓提额';});
    // Rules removed or expired: release only if the downloader still holds our last confirmed value.
    for (const [key,record] of Object.entries(owned).filter(([k])=>k.startsWith(`${mode}|`) && !valid.has(k))) {
      if (!await this.restoreRecord(key,record,owned,liveByKey)) blockIncrease = true;
    }
    this.store.set('managed',owned);
    for(const key of this.limitResults.keys())if(key.startsWith(mode+'|')&&!valid.has(key)&&!owned[key])this.clearIssue(key);
    this.plan.forEach(p=>this.results.set(p.key,p.execution || ''));
  }
  async restoreRecord(key, record, owned, liveByKey) {
    const c = this.clients().find(c=>c.id===record.clientId), rt = this.runtime.get(record.clientId);
    if (!c || !rt?.online || record.conflict || Object.hasOwn(record,'pending')) return false;
    // A deleted torrent no longer has a setting to restore.
    const currentTorrent = liveByKey?.get(record.key) || (!liveByKey ? this.torrents().find(t=>t.key===record.key):null);
    if (!currentTorrent) { delete owned[key]; return true; }
    if (currentTorrent.metadataReady === false) return false;
    record.torrentId = currentTorrent.id;
    const adapter = this.adapter(c);
    try {
      if (!sameLimit(await adapter.readLimit(record.torrentId,record.direction),record.last)) {
        record.issue='external';record.issueMessage='恢复前发现下载器限速被外部修改';record.issueTime=Date.now();
        record.conflict = true; this.store.event('恢复已跳过',`${record.name} 的限速已被外部修改，保留当前设置`,'warning'); return false;
      }
      if(record.baselineState && adapter.restoreLimitState) await adapter.restoreLimitState(record.torrentId,record.direction,record.baselineState);
      else await adapter.setLimit(record.torrentId,record.direction,record.baseline);
      if (!sameLimit(await adapter.readLimit(record.torrentId,record.direction),record.baseline)) throw new Error('恢复值未确认');
      if(record.baselineState && adapter.readLimitState) {
        const restored=await adapter.readLimitState(record.torrentId,record.direction);
        for(const field of Object.keys(record.baselineState)) if(restored[field]!==record.baselineState[field]) throw new Error('原始限速开关或保留值未完整恢复');
      }
      const torrent = rt.torrents.find(t=>String(t.id)===String(record.torrentId)); if (torrent) torrent[`${record.direction}Limit`] = record.baseline;
      delete owned[key]; this.clearIssue(key);this.store.event('已恢复接管前设置',record.name,'success'); return true;
    } catch(e) { this.store.event('恢复未完成',`${record.name}：${e.message}`,'warning'); return false; }
  }
  async release() {
    if (this.busy) throw new Error('正在同步，请稍后再试');
    this.busy = true;
    try {
      this.store.set('settings',{...this.store.get('settings'),controlEnabled:false});
      if(activeRuns(this.store).length)this.quickActions.stop();
      const owned = this.store.get('managed',{}), prefix = `${this.store.get('settings').mode}|`;
      const liveByKey = new Map(this.torrents().map(t=>[t.key,t]));
      for (const [key,record] of Object.entries(owned).filter(([k])=>k.startsWith(prefix))) { await this.restoreRecord(key,record,owned,liveByKey); this.store.set('managed',owned); }
      for(const key of this.limitResults.keys())if(key.startsWith(prefix)&&!owned[key])this.clearIssue(key);
      return { remaining:Object.keys(owned).filter(k=>k.startsWith(prefix)).length };
    } finally { this.busy = false; }
  }
  async reclaim(key) {
    if (this.busy) throw new Error('正在同步，请稍后再试');
    this.busy = true;
    try {
    const owned = this.store.get('managed',{}), p = this.plan.find(p=>p.key===key);
    if (!p?.online) throw new Error('请先连接该任务所属的下载器');
    const c = this.clients().find(c=>c.id===p.clientId), adapter = this.adapter(c);
    for (const dir of ['upload','download']) {
      const k = this.managedKey(key,dir), rec = owned[k]; if (!rec) continue;
      const current = await adapter.readLimit(p.torrentId,dir);
      // Resolve an uncertain write by adopting the actual value, while retaining the original baseline.
      rec.last = current; rec.conflict = false; delete rec.pending;delete rec.issue;delete rec.issueMessage;delete rec.issueTime;this.clearIssue(k);
    }
    this.store.set('managed',owned); this.store.event('已重新接管任务',p.name);
    } finally { this.busy = false; }
  }
  state() {
    if(!this.busy)this.replan();
    const clients = this.clients().map(c => {
      const rt = this.runtime.get(c.id) || {};
      return { id:c.id,name:c.name,type:c.type,demo:c.demo,online:!!rt.online,version:rt.version || '',upload:rt.online ? rt.upload:0,download:rt.online ? rt.download:0,torrentCount:rt.torrents?.length || 0,active:rt.torrents?.filter(t=>t.upload+t.download>0).length || 0,time:rt.time,error:rt.error || '',native:rt.native };
    });
    const managed = this.store.get('managed',{});
    const limitStatus=limitStatuses(Object.values(managed).filter(m=>m.mode===this.store.get('settings').mode),this.limitOperations,this.limitResults,this.store.get('settings').mode).counts;
    return { settings:this.store.get('settings'),clients,configuredClients:this.store.publicClients(),pools:this.store.get('pools',[]),rules:this.store.get('rules',[]),ruleRevision:ruleRevision(this.store.get('rules',[])),torrents:this.torrents(),plan:this.plan,managed:Object.values(managed).filter(m=>m.mode===this.store.get('settings').mode),limitStatus,history:this.store.history(this.store.get('settings').mode),events:this.store.events(),syncing:this.busy,lastControl:this.lastControl,error:this.error,now:Date.now() };
  }
  start() { const loop = async () => { await this.refresh(); this.timer = setTimeout(loop,this.store.get('settings').pollSeconds*1000); }; void loop(); }
  stop() { clearTimeout(this.timer); }
}
