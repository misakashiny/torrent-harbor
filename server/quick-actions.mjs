import { createHash, randomUUID } from 'node:crypto';
import { buildPlan, sameLimit } from './engine.mjs';

const bad = (message, status=400) => { throw Object.assign(new Error(message), {status}); };
const directions = ['upload','download'];
export const quickRevision = definitions => createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
export function activeRuns(store, now=Date.now()) {
  const mode=store.get('settings').mode;
  return store.get('activeQuickActions',[]).filter(r=>r.mode===mode&&(r.expires===null||r.expires>now));
}
// Runs are ordered by execution, and each direction is resolved independently.
export function quickPolicy(runs) {
  const policy={};
  for(const run of runs) for(const effect of run.effects) for(const id of effect.poolIds) {
    policy[id] ||= {};
    for(const dir of effect.directions) policy[id][dir]={kind:effect.kind,value:effect.kind==='unlimited'?null:effect[dir],name:run.name,runId:run.id,expires:run.expires};
  }
  return policy;
}
export function validateQuickAction(input, pools) {
  if(!input||typeof input!=='object')bad('一键操作格式无效');
  const name=typeof input.name==='string'?input.name.trim():'';
  if(!name||name.length>40)bad('按钮名称需为 1–40 个字符');
  const minutes=input.minutes??null;
  if(minutes!==null&&(!Number.isInteger(minutes)||minutes<1||minutes>10080))bad('恢复时间需为 1–10080 分钟，手动恢复请留空');
  if(!Array.isArray(input.effects)||!input.effects.length||input.effects.length>8)bad('每个按钮需包含 1–8 条效果');
  const used=new Set(), ids=new Set(pools.map(p=>p.id));
  const effects=input.effects.map(e=>{
    if(!e||!['unlimited','per-torrent','shared'].includes(e.kind))bad('请选择不限速、每种限速或每站共享限速');
    if(!Array.isArray(e.poolIds)||!e.poolIds.length||e.poolIds.length>300||e.poolIds.some(id=>!ids.has(id)))bad('请选择有效的站点 / 带宽池');
    if(!Array.isArray(e.directions)||!e.directions.length||e.directions.some(d=>!directions.includes(d)))bad('请选择上传或下载方向');
    const result={kind:e.kind,poolIds:[...new Set(e.poolIds)],directions:[...new Set(e.directions)],upload:null,download:null};
    for(const id of result.poolIds)for(const dir of result.directions){const key=id+':'+dir;if(used.has(key))bad('同一按钮内，同一站点的同一方向只能设置一次');used.add(key);}
    for(const dir of result.directions)if(e.kind!=='unlimited'){
      const n=e[dir];if(typeof n!=='number'||!Number.isFinite(n)||n<1024||n>1024**5)bad('限速至少为 1 KiB/s，请填写所选方向的上限');result[dir]=Math.floor(n);
    }
    return result;
  });
  return {name,minutes,effects};
}
export class QuickActions {
  constructor(controller){this.controller=controller;this.store=controller.store;}
  state(now=Date.now()){
    const definitions=this.store.get('quickActions',[]), runs=activeRuns(this.store,now);
    return {definitions,revision:quickRevision(definitions),runs,mode:this.store.get('settings').mode,controlled:this.store.get('settings').controlEnabled};
  }
  changed(title,run){this.controller.lastControl=0;this.controller.replan();this.store.event(title,run.name||'全部一键操作','info',{code:'quick.changed',actionId:run.actionId||run.id,effects:run.effects,expires:run.expires,mode:this.store.get('settings').mode,preview:!this.store.get('settings').controlEnabled});}
  revision(value){if(value!==quickRevision(this.store.get('quickActions',[])))bad('按钮配置已更新，请重新载入后再保存',409);}
  save(input,id){
    this.revision(input.revision);
    const definitions=this.store.get('quickActions',[]), i=definitions.findIndex(d=>d.id===id);
    if(id&&i<0)bad('按钮不存在',404);if(!id&&definitions.length>=40)bad('最多保存 40 个按钮');
    const item={...validateQuickAction(input,this.store.get('pools',[])),id:id||randomUUID()};
    if(i<0)definitions.push(item);else definitions[i]=item;
    this.store.set('quickActions',definitions);this.store.event('一键按钮已保存',item.name,'info',{code:'quick.saved',actionId:item.id});return this.state();
  }
  remove(id,revision){
    this.revision(revision);
    if(this.store.get('activeQuickActions',[]).some(r=>r.actionId===id&&(r.expires===null||r.expires>Date.now())))bad('请先停止这个按钮在各环境中的效果，再删除');
    const old=this.store.get('quickActions',[]);if(!old.some(d=>d.id===id))bad('按钮不存在',404);
    this.store.set('quickActions',old.filter(d=>d.id!==id));return this.state();
  }
  candidate(input,now=Date.now()){
    const source=input.actionId?this.store.get('quickActions',[]).find(d=>d.id===input.actionId):input;
    if(!source)bad('按钮不存在',404);
    if(input.actionId)this.revision(input.revision);
    return {...validateQuickAction(source,this.store.get('pools',[])),id:'preview',actionId:input.actionId||'',mode:this.store.get('settings').mode,started:now,expires:source.minutes==null?null:now+source.minutes*60000};
  }
  preview(input,now=Date.now()){
    const run=this.candidate(input,now), s=this.store, c=this.controller;
    const current=activeRuns(s,now), previous=current.filter(r=>r.actionId!==run.actionId||!run.actionId);
    const planFor=runs=>buildPlan(c.torrents(),s.get('rules',[]),s.get('pools',[]),s.get('settings'),s.get('overrides',{}),new Date(now),quickPolicy(runs));
    const old=new Map(planFor(current).map(p=>[p.key,p])), plan=planFor([...previous,run]);
    const targets=plan.filter(p=>Object.values(p.quick||{}).some(q=>q.runId==='preview'));
    const changed=plan.filter(p=>directions.some(d=>!sameLimit(p[d],old.get(p.key)?.[d])));
    const problems=new Set();
    for(const p of plan.filter(p=>p.managed&&p.online))for(const dir of directions){const adapter=c.adapter(c.clients().find(v=>v.id===p.clientId));const problem=adapter.limitProblem?.(p[dir]);if(problem)problems.add(problem);if(p[dir]===0||p[dir]!=null&&adapter.quantize(p[dir])<=0)problems.add('分配份额小于下载器可执行粒度，请提高共享上限或减少成员');}
    return {targets:targets.length,offline:targets.filter(p=>!p.online).length,clients:[...new Set(targets.map(p=>p.clientId))].length,changed:changed.length,problems:[...problems],samples:targets.slice(0,12).map(({key,name,poolName,upload,download,online})=>({key,name,poolName,upload,download,online})),controlled:s.get('settings').controlEnabled};
  }
  run(input,now=Date.now()){
    if(!input.actionId)bad('请先保存按钮再执行');
    const run=this.candidate(input,now), preview=this.preview(input,now);
    if(preview.problems.length)bad(preview.problems[0]+'；尚未执行',422);
    run.id=randomUUID();const runs=this.store.get('activeQuickActions',[]).filter(r=>r.mode!==run.mode||r.actionId!==run.actionId);
    runs.push(run);this.store.set('activeQuickActions',runs);this.changed('一键效果已启动',run);return {...this.state(now),preview};
  }
  stop(id){
    const mode=this.store.get('settings').mode, old=this.store.get('activeQuickActions',[]), stopped=old.filter(r=>r.mode===mode&&(!id||r.id===id));
    if(id&&!stopped.length)bad('运行效果已结束，请刷新',404);
    this.store.set('activeQuickActions',old.filter(r=>!stopped.includes(r)));this.changed('一键效果已停止',{name:stopped.map(r=>r.name).join('、')});return this.state();
  }
  expire(now=Date.now()){
    const old=this.store.get('activeQuickActions',[]), expired=old.filter(r=>r.expires!==null&&r.expires<=now);
    if(!expired.length)return;
    this.store.set('activeQuickActions',old.filter(r=>!expired.includes(r)));this.changed('一键效果已到期',{name:expired.map(r=>r.name).join('、')});
  }
}
