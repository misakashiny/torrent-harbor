import { ruleRevision } from './rule-order.mjs';
import { activeRuns, quickRevision } from './quick-actions.mjs';

const pageSizes = [25, 50, 100, 200, 300];
const bad = message => { throw Object.assign(new Error(message), {status:400}); };
// Read projections use the controller's snapshots. They never contact a downloader or write limits.
export class ReadModel {
  constructor(controller, version) { this.controller=controller; this.store=controller.store; this.version=version; }
  snapshot(now=Date.now()) {
    const c=this.controller, s=this.store;
    const stamp=JSON.stringify([s.db.prepare('SELECT total_changes() AS n').get().n,s.db.prepare('PRAGMA data_version').get().data_version,c.busy,c.lastControl,c.lastSample,c.error,[...c.runtime].map(([id,r])=>[id,r.time,r.checked,r.online]),Math.floor(now/5000)]);
    if(this.cached?.stamp===stamp)return this.cached;
    // apply() holds and annotates its plan across awaits. A read must not replace that plan.
    if(!c.busy)c.replan();
    const settings=s.get('settings'), pools=s.get('pools',[]), rules=s.get('rules',[]);
    const plans=new Map(c.plan.map(p=>[p.key,p]));
    const clients=c.clients().map(v=>{const r=c.runtime.get(v.id)||{};return {id:v.id,name:v.name,type:v.type,demo:v.demo,online:!!r.online,pending:!r.time&&!r.checked,stale:!r.online||!r.time||now-r.time>Math.max(30000,settings.pollSeconds*3000),version:r.version||'',upload:r.online?r.upload:0,download:r.online?r.download:0,lastUpload:r.upload??null,lastDownload:r.download??null,time:r.time||null,error:r.error||'',native:r.native,torrentCount:r.torrents?.length||0,active:r.online?(r.torrents||[]).filter(t=>t.upload+t.download>0).length:0};});
    const clientMap=new Map(clients.map(c=>[c.id,c]));
    const rows=c.torrents().map(t=>({...t,stale:clientMap.get(t.clientId)?.stale??true,plan:plans.get(t.key)||null}));
    const byKey=new Map(rows.map(t=>[t.key,t]));
    const poolStats=Object.fromEntries(pools.map(p=>[p.id,{count:0,upload:0,download:0,allocated:0,offline:0,time:null}]));
    const ruleCounts={};
    for(const t of rows){const p=t.plan, v=poolStats[p?.poolId];if(v){v.count++;if(t.online&&!t.stale){v.upload+=t.upload;v.download+=t.download;}else v.offline++;if(t.updated)v.time=Math.min(v.time??Infinity,t.updated);v.allocated+=p?.upload||0;}for(const r of p?.matchedRules||[])ruleCounts[r.id]=(ruleCounts[r.id]||0)+1;}
    const owned=Object.values(s.get('managed',{})).filter(m=>m.mode===settings.mode);
    const summary={version:this.version,settings,clients,pools,poolStats,ruleCounts,total:rows.length,active:clients.reduce((n,v)=>n+v.active,0),managedCount:owned.length,conflictCount:owned.filter(m=>m.conflict||Object.hasOwn(m,'pending')).length,matchedCount:rows.filter(t=>t.plan?.managed).length,blocked:c.plan.find(p=>p.execution?.includes('本轮限速计划未执行'))?.execution||'',history:s.history(settings.mode),topTorrents:[...rows].filter(t=>t.online).sort((a,b)=>b.upload+b.download-a.upload-a.download||a.key.localeCompare(b.key)).slice(0,5),syncing:c.busy,lastControl:c.lastControl,error:c.error,now};
    summary.quickActions={revision:quickRevision(s.get('quickActions',[])),runs:activeRuns(s,now)};
    this.cached={stamp,rows,byKey,plans,summary,owned}; return this.cached;
  }
  summary(){return this.snapshot().summary;}
  workspace(){const s=this.store;return {configuredClients:s.publicClients(),rules:s.get('rules',[]),ruleRevision:ruleRevision(s.get('rules',[]))};}
  catalog(){const {rows}=this.snapshot();return {hosts:[...new Set(rows.flatMap(t=>t.hosts))].sort(),tags:[...new Set(rows.flatMap(t=>t.tags))].sort()};}
  torrents(params={}) {
    const {rows}=this.snapshot();
    const size=Number(params.pageSize||25), page=Number(params.page||1), sort=params.sort||'name', order=params.order||'asc';
    if(!pageSizes.includes(size)||!Number.isSafeInteger(page)||page<1)bad('分页参数无效');
    if(!['name','upload','download','progress','updated'].includes(sort)||!['asc','desc'].includes(order))bad('排序参数无效');
    if(params.q?.length>200)bad('搜索内容过长');
    const q=(params.q||'').trim().toLowerCase();
    const filtered=rows.filter(t=>(!q||[t.name,t.clientName,...t.tags,...t.hosts].join(' ').toLowerCase().includes(q))&&(!params.client||t.clientId===params.client)&&(!params.host||t.hosts.includes(params.host))&&(!params.tag||t.tags.includes(params.tag))&&(!params.pool||t.plan?.poolId===params.pool)&&(!params.state||(params.state==='offline'?!t.online:t.online&&t.state===params.state)));
    const direction=order==='asc'?1:-1;
    filtered.sort((a,b)=>(sort==='name'?a.name.localeCompare(b.name,'zh-CN'):(a[sort]||0)-(b[sort]||0))*direction||a.key.localeCompare(b.key));
    const pages=Math.max(1,Math.ceil(filtered.length/size)), current=Math.min(page,pages);
    return {rows:filtered.slice((current-1)*size,current*size),total:filtered.length,page:current,pageSize:size,pages};
  }
  detail(key){const s=this.snapshot(),torrent=s.byKey.get(key);if(!torrent)throw Object.assign(new Error('种子已不存在，请刷新列表'),{status:404});return {torrent,managed:s.owned.filter(m=>m.key===key)};}
}
