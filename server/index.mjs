import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Store } from './store.mjs';
import { Controller } from './controller.mjs';
import { createAdapter, validateUrl } from './adapters.mjs';
import { MiB } from './engine.mjs';
import { UpdateManager } from './updates.mjs';
import { reorderRules } from './rule-order.mjs';
import { validateIcon } from './site-icons.mjs';
import { redact } from './logs.mjs';
import { ReadModel } from './read-model.mjs';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
const appMeta=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const store = new Store(resolve(process.env.DATA_DIR || join(root,'data')));
if (!store.get('admin') && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD 至少 10 位');
  store.set('admin',store.password(process.env.ADMIN_PASSWORD));
}
const controller = new Controller(store), sessions = new Map(), failures = new Map();
const readModel = new ReadModel(controller,appMeta.version);
const updates=new UpdateManager(store,{version:appMeta.version,directory:process.env.UPDATE_STATE_DIR});
const fail = (message,status=400) => { const e = new Error(message); e.status=status; throw e; };
const json = (res,body,status=200,headers={}) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(body)); };
const clean = value => String(value ?? '').trim();
const name = value => { const v=clean(value); if (!v || v.length>100) fail('名称需为 1–100 个字符'); return v; };
const list = (value,max=100) => { if (!Array.isArray(value) || value.length>max || value.some(v=>typeof v!=='string'||v.length>200)) fail('条件列表格式不正确'); return [...new Set(value.map(v=>v.trim()).filter(Boolean))]; };
const limit = value => { if (value===null || value==='' || value===undefined) return null; if (typeof value!=='number'||!Number.isFinite(value)||value<1024||value>1024**5) fail('限速必须至少为 1 KiB/s；不限速请留空'); return Math.floor(value); };
const number = (v,min,max,label) => { if (!Number.isFinite(v)||v<min||v>max) fail(`${label}超出允许范围`); return v; };
const password = v => { if (typeof v!=='string'||v.length<10||v.length>256) fail('管理密码需为 10–256 个字符'); return v; };
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail('请求需要 JSON 格式',415);
  const chunks=[]; let n=0;
  for await(const chunk of req) { n+=chunk.length; if(n>256000) fail('请求内容过大',413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { fail('JSON 格式不正确'); }
}
function session(req) {
  const token=(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('harbor='))?.slice(7);
  const expires=sessions.get(token); if (!expires || expires<Date.now()) { if(token) sessions.delete(token); return null; } return token;
}
function signin(res) {
  const token=randomBytes(32).toString('hex'); sessions.set(token,Date.now()+86400000*7);
  for(const [k,t] of sessions) if(t<Date.now()) sessions.delete(k);
  json(res,{ok:true},200,{'Set-Cookie':`harbor=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`});
}
function config(key,item,id) {
  const values=store.get(key,[]), i=values.findIndex(v=>v.id===id);
  if(id && i<0) fail('记录不存在',404);
  item.id=id || randomUUID(); if(i<0) values.push(item); else values[i]=item;
  store.set(key,values); controller.lastControl=0; controller.replan(); return item;
}
function ruleInput(b) {
  const hosts=list(b.hosts || []).map(v=>v.toLowerCase());
  if(hosts.some(h=>!/^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(h)||!h.includes('.')||h.includes('..'))) fail('Tracker 条件请填写主机名，例如 tracker.example.org；不含路径或 passkey');
  const clients=list(b.clients || []); if(clients.some(id=>!store.get('clients',[]).some(c=>c.id===id))) fail('下载器条件中存在无效记录');
  const states=list(b.states || []); if(states.some(s=>!['downloading','seeding','paused','stalled','checking','error'].includes(s))) fail('任务状态无效');
  let schedule=null;
  if(b.schedule) {
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.schedule.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.schedule.end)) fail('时间段格式应为 HH:mm');
    const days=b.schedule.days || []; if(!Array.isArray(days)||days.some(v=>!Number.isInteger(v)||v<0||v>6)) fail('星期配置无效');
    schedule={start:b.schedule.start,end:b.schedule.end,days};
  }
  const poolId=clean(b.poolId); if(poolId&&!store.get('pools',[]).some(p=>p.id===poolId)) fail('所选带宽池不存在');
  const upload=limit(b.upload), download=limit(b.download), weight=number(Number(b.weight??1),1,100,'权重');
  if(!poolId&&upload==null&&download==null&&weight===1) fail('请设置带宽池、单种限速或优先权重');
  return {name:name(b.name),enabled:b.enabled!==false,priority:number(Number(b.priority??50),0,9999,'优先级'),clients,hosts,tags:list(b.tags||[]),category:clean(b.category).slice(0,200),states,poolId,upload,download,weight,schedule};
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url=new URL(req.url,'http://local'), path=url.pathname, method=req.method;
    if(path==='/api/health') return json(res,{ok:true,app:'torrent-harbor',version:appMeta.version});
    if(path==='/api/auth/status'&&method==='GET') return json(res,{setup:!store.get('admin'),authenticated:Boolean(session(req))});
    if(path.startsWith('/api/')) {
      if(!['GET','POST','PUT','DELETE'].includes(method)) fail('不支持的请求方法',405);
      if(method!=='GET'&&req.headers.origin) {
        let origin; try { origin=new URL(req.headers.origin); } catch { fail('来源不正确',403); }
        if(origin.host!==req.headers.host) fail('拒绝跨站修改请求',403);
      }
      if(path==='/api/auth/setup'&&method==='POST') {
        const b=await body(req); if(store.get('admin')) fail('管理员已设置',409);
        store.set('admin',store.password(password(b.password))); store.event('管理员已创建','首次设置完成'); return signin(res);
      }
      if(path==='/api/auth/login'&&method==='POST') {
        const address=req.socket.remoteAddress, record=failures.get(address);
        if(record?.until>Date.now()&&record.count>=8) fail('尝试次数过多，请 10 分钟后再试',429);
        const b=await body(req);
        if(typeof b.password!=='string'||b.password.length>256||!store.verify(b.password)) {
          failures.set(address,{count:(record?.until>Date.now()?record.count:0)+1,until:Date.now()+600000}); fail('管理密码不正确',401);
        }
        failures.delete(address); return signin(res);
      }
      if(!session(req)) fail('请先登录',401);
      if(method==='GET') {
        if(path==='/api/summary')return json(res,readModel.summary());
        if(path==='/api/workspace')return json(res,readModel.workspace());
        if(path==='/api/catalog')return json(res,readModel.catalog());
        if(path==='/api/events')return json(res,store.events());
        if(path==='/api/torrents')return json(res,readModel.torrents(Object.fromEntries(url.searchParams)));
        if(path.startsWith('/api/torrents/'))return json(res,readModel.detail(decodeURIComponent(path.slice(14))));
      }
      if(path==='/api/traffic'&&method==='GET') {
        try {return json(res,store.traffic.totals(store.get('settings').mode,controller.clients(),url.searchParams.get('range')||'1h',controller.runtime,Date.now(),Math.max(60000,store.get('settings').pollSeconds*3000)));}catch(e){fail(e.message);}
      }
      if(path==='/api/logs'&&method==='GET') {try{return json(res,store.logs.query(Object.fromEntries(url.searchParams)));}catch(e){fail(e.message);}}
      if(path==='/api/diagnostics'&&method==='GET') {
        const s=controller.state();return json(res,redact({app:'torrent-harbor',version:appMeta.version,exported:new Date().toISOString(),settings:s.settings,clients:s.clients.map(({id,name,type,online,version,error,native,time})=>({id,name,type,online,version,error,native,time})),rules:s.rules.length,pools:s.pools.length,managed:s.managed.length,logs:store.logs.query({...Object.fromEntries(url.searchParams),page:1,pageSize:200}).rows,note:'不含连接配置、密码或恢复密钥；日志可能包含任务名称、标识及错误上下文，凭证已自动隐藏。'},0,200));
      }
      if(path==='/api/updates'&&method==='GET') return json(res,updates.status());
      if(path.startsWith('/api/updates/')&&method!=='GET') {
        const b=await body(req);
        try {
          if(path==='/api/updates/config'&&method==='PUT') return json(res,updates.configure(b));
          if(path==='/api/updates/check'&&method==='POST') return json(res,await updates.check());
          if(path==='/api/updates/plan'&&method==='POST') return json(res,updates.plan(b.action||'update'));
          if(path==='/api/updates/apply'&&method==='POST') return json(res,updates.queue(b.planId),202);
        } catch(error) { fail(error.message,422); }
        fail('更新接口不存在',404);
      }
      if(path==='/api/auth/logout'&&method==='POST') { sessions.delete(session(req)); return json(res,{ok:true},200,{'Set-Cookie':'harbor=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'}); }
      if(path==='/api/auth/password'&&method==='POST') { const b=await body(req); if(!store.verify(String(b.current||''))) fail('当前密码不正确',403); store.set('admin',store.password(password(b.password))); sessions.clear(); return signin(res); }
      if(path==='/api/state'&&method==='GET') return json(res,{...controller.state(),version:appMeta.version});
      if(path==='/api/refresh'&&method==='POST') { await controller.refresh(false); return json(res,readModel.summary()); }
      if(path==='/api/release'&&method==='POST') { if(controller.busy) fail('正在同步下载器，请稍后重试',409); return json(res,await controller.release()); }
      if(path==='/api/reclaim'&&method==='POST') { const b=await body(req); if(controller.busy) fail('正在同步下载器，请稍后重试',409); try { await controller.reclaim(clean(b.key)); } catch(e) { fail(e.message,422); } return json(res,{ok:true}); }
      if(path==='/api/clients/test'&&method==='POST') {
        const b=await body(req), old=store.get('clients',[]).find(c=>c.id===b.id);
        if(!['qb','tr'].includes(b.type)) fail('下载器类型无效');
        const adapter=createAdapter({type:b.type,url:validateUrl(b.url),username:clean(b.username)},typeof b.password==='string'&&b.password ? b.password:store.unseal(old?.password));
        let result; try { result=await adapter.snapshot(); } catch(e) { fail(e.message,422); } return json(res,{ok:true,version:result.version,torrents:result.torrents.length,native:result.native});
      }
      const b=method==='POST'||method==='PUT' ? await body(req):{};
      if(controller.busy) fail('正在同步下载器，请稍后重试',409);
      if(path==='/api/rules/order'&&method==='PUT') {
        let rules;try{rules=reorderRules(store.get('rules',[]),b);}catch(e){fail(e.message,e.status||400);}
        store.set('rules',rules);controller.lastControl=0;controller.replan();store.event('规则优先级已更新',`已排列 ${rules.length} 条规则`,'success',{code:'rules.reordered',ids:rules.map(r=>r.id)});return json(res,{ok:true});
      }
      if(path==='/api/settings'&&method==='PUT') {
        const old=store.get('settings'), mode=b.mode??old.mode;
        if(!['demo','real'].includes(mode)) fail('运行环境无效');
        if(mode!==old.mode&&Object.values(store.get('managed',{})).some(m=>m.mode===old.mode)) fail('切换环境前，请先释放当前接管并恢复设置');
        const timezone=clean(b.timezone||old.timezone); try { new Intl.DateTimeFormat('en',{timeZone:timezone}).format(); } catch { fail('时区无效'); }
        const next={...old,mode,controlEnabled:mode!==old.mode ? false:Boolean(b.controlEnabled??old.controlEnabled),demandAware:Boolean(b.demandAware??old.demandAware??true),uploadBudget:limit(b.uploadBudget===undefined?old.uploadBudget:b.uploadBudget),downloadBudget:limit(b.downloadBudget===undefined?old.downloadBudget:b.downloadBudget),pollSeconds:number(Number(b.pollSeconds??old.pollSeconds),3,300,'同步间隔'),controlSeconds:number(Number(b.controlSeconds??old.controlSeconds),10,600,'调度间隔'),timezone};
        store.set('settings',next); controller.lastControl=0;
        store.event('运行设置已更新',`${mode==='demo'?'演示':'真实'}环境 · ${next.controlEnabled?'自动接管已开启':'只读预览'}`);
        if(mode!==old.mode) { controller.plan=[]; controller.lastSample=0; void controller.refresh(false); }
        return json(res,{ok:true});
      }
      const m=path.match(/^\/api\/(clients|pools|rules)(?:\/([^/]+))?$/);
      if(m) {
        const [,collection,id]=m;
        if(method==='DELETE') {
          if(!id) fail('缺少记录标识');
          if(collection==='clients') {
            if(store.get('clients',[]).find(c=>c.id===id)?.demo) fail('示例下载器在演示环境中保留');
            if(Object.values(store.get('managed',{})).some(m=>m.clientId===id)) fail('请先释放该下载器的接管设置');
            if(store.get('rules',[]).some(r=>r.clients?.includes(id))) fail('请先修改引用该下载器的规则');
          }
          if(collection==='pools'&&store.get('rules',[]).some(r=>r.poolId===id)) fail('请先移除引用该池的规则');
          const existing=store.get(collection,[]); if(!existing.some(x=>x.id===id)) fail('记录不存在',404);
          store.set(collection,existing.filter(x=>x.id!==id)); store.event('配置已删除',collection); controller.lastControl=0; return json(res,{ok:true});
        }
        if(!['POST','PUT'].includes(method)) fail('不支持的请求方法',405);
        let item;
        if(collection==='clients') {
          const old=store.get('clients',[]).find(c=>c.id===id);
          if(old?.demo) fail('示例下载器无需修改');
          if(!['qb','tr'].includes(b.type)) fail('下载器类型无效');
          if(typeof b.password!=='string'&&b.password!==undefined) fail('密码格式无效');
          if(b.password?.length>1024) fail('密码过长');
          if(old&&Object.values(store.get('managed',{})).some(m=>m.clientId===id)&&(old.url!==b.url||old.type!==b.type||b.enabled===false)) fail('更换地址、类型或停用前，请先释放接管');
          item={name:name(b.name),type:b.type,url:validateUrl(b.url),username:clean(b.username).slice(0,200),password:b.password ? store.seal(b.password):old?.password || '',demo:false,enabled:b.enabled!==false};
        }
        if(collection==='pools') {
          let icon;try{icon=validateIcon(b.icon??store.get('pools',[]).find(p=>p.id===id)?.icon??'auto');}catch(e){fail(e.message);}
          item={name:name(b.name),icon,color:/^#[a-fA-F0-9]{6}$/.test(b.color)?b.color:'#218575',upload:limit(b.upload),download:limit(b.download),weight:number(Number(b.weight??1),1,100,'权重')};
        }
        if(collection==='rules') item=ruleInput(b);
        const result=config(collection,item,id); store.event('配置已保存',item.name);
        if(collection==='clients') { const {password,...publicItem}=result; return json(res,{...publicItem,hasPassword:!!password}); }
        return json(res,result);
      }
      if(path==='/api/preview'&&method==='POST') {
        const {buildPlan}=await import('./engine.mjs');
        const rule={...ruleInput(b),id:b.id||'preview'};
        const rules=store.get('rules',[]).filter(r=>r.id!==b.id); rules.push(rule);
        const plan=buildPlan(controller.torrents(),rules,store.get('pools',[]),store.get('settings'),store.get('overrides',{}));
        return json(res,{matches:plan.filter(p=>p.matchedRules.some(r=>r.id===rule.id)),total:plan.length});
      }
      if(path==='/api/labels'&&method==='PUT') {
        const keys=list(b.keys||[],5000), tags=list(b.tags||[]); if(tags.some(t=>t.length>40)) fail('每个标签最多 40 字符');
        const valid=new Set(controller.torrents().map(t=>t.key)),labels=store.get('labels',{}); keys.forEach(k=>{if(!valid.has(k)) fail('任务不存在'); labels[k]=tags;}); store.set('labels',labels); controller.lastControl=0; return json(res,{ok:true});
      }
      if(path==='/api/override'&&method==='POST') {
        const keys=list(b.keys||[],5000), overrides=store.get('overrides',{}),valid=new Set(controller.torrents().map(t=>t.key));
        for(const key of keys) {
          if(!valid.has(key)) fail('任务不存在');
          if(b.clear) delete overrides[key];
          else overrides[key]={expires:Date.now()+number(Number(b.minutes??30),1,1440,'临时时长')*60000,upload:limit(b.upload),download:limit(b.download),weight:number(Number(b.weight??3),1,100,'临时权重')};
        }
        store.set('overrides',overrides); controller.lastControl=0; store.event(b.clear?'已取消临时设置':'临时设置已保存',`${keys.length} 个任务`); return json(res,{ok:true});
      }
      if(path==='/api/export'&&method==='GET') return json(res,{app:'torrent-harbor',version:1,exported:new Date().toISOString(),settings:{...store.get('settings'),controlEnabled:false},pools:store.get('pools'),rules:store.get('rules'),clients:store.publicClients(),note:'不含连接密码、管理密码、应用标签和恢复基线；完整备份请保存整个 data 目录。'});
      fail('接口不存在',404);
    }
    if(!['GET','HEAD'].includes(method)) fail('不支持的请求方法',405);
    const dist=join(root,'dist');
    let file=resolve(dist,`.${decodeURIComponent(path)}`);
    if(file!==dist&&!file.startsWith(`${dist}${sep}`)) fail('路径无效',403);
    try { if(!(await stat(file)).isFile()) file=join(dist,'index.html'); } catch { file=join(dist,'index.html'); }
    const content=await readFile(file), mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp','.jpg':'image/jpeg','.txt':'text/plain; charset=utf-8'}[extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=86400'}); res.end(method==='HEAD'?undefined:content);
  } catch(e) {
    if(!e.status||e.status>=500)store.logs.write({level:'error',scope:'http',code:'request.failed',message:'请求处理失败',context:{method:req.method,path:req.url?.split('?')[0],error:e.message,stack:e.stack}});
    if(!res.headersSent) json(res,{error:e.status?e.message:'操作未完成，请检查连接或服务记录'},e.status||500);
    else res.end();
  }
});
server.requestTimeout=30000;
const port=Number(process.env.PORT||18977), host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>{console.log(`Torrent Harbor v${appMeta.version} · http://${host==='0.0.0.0'?'localhost':host}:${port}`);store.logs.write({scope:'system',code:'app.started',message:'种子港已启动',context:{version:appMeta.version}}); controller.start();updates.start();});
async function shutdown() { controller.stop();updates.stop(); server.close(); const until=Date.now()+12000; while(controller.busy&&Date.now()<until) await new Promise(r=>setTimeout(r,100)); store.close(); process.exit(0); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
