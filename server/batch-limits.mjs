import { sameLimit } from './engine.mjs';

export const BATCH_SIZE=100;
export function limitBatches(tasks) {
  const groups=new Map();
  for(const t of tasks){const k=JSON.stringify([t.c.id,t.dir,!!t.restore]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(t);}
  return [...groups.values()].flatMap(g=>Array.from({length:Math.ceil(g.length/BATCH_SIZE)},(_,i)=>g.slice(i*BATCH_SIZE,(i+1)*BATCH_SIZE)));
}
const exactState=(actual,expected)=>actual&&Object.keys(expected).every(k=>actual[k]===expected[k]);
export class BatchLimits {
  constructor(controller,owned) { this.c=controller;this.owned=owned;this.job=controller.job;this.mode=controller.store.get('settings').mode;this.runtime=new Map([...controller.runtime].map(([id,r])=>[id,new Map((r.torrents||[]).map(t=>[String(t.id),t]))])); }
  settle(t,kind) { if(!t.settled){this.job.count(kind);t.settled=true;} }
  fail(t,error) {
    if(t.settled)return;
    const external=error.limitIssue==='external',record=this.owned[t.key];
    this.c.issue(t.key,external?'conflict':'failed',error.message);
    if(record)Object.assign(record,{conflict:true,issue:external?'external':'failed',issueMessage:error.message,issueTime:Date.now()});
    if(t.p)t.p.execution=error.message;
    this.settle(t,external?'conflict':'failed');
    this.c.store.event(external?'检测到外部限速修改':t.restore?'恢复未完成':'限速修改未确认',`${t.p?.name||t.record?.name}：${error.message}`,'warning',{code:external?'limit.external_change':t.restore?'limit.restore_failed':'limit.unconfirmed',clientId:t.c.id,torrentId:t.id,direction:t.dir,error:error.message,jobId:this.job.value?.id});
  }
  async execute(batch,increasing=false) {
    const {c,adapter,dir,restore}=batch[0],ids=batch.map(t=>t.id),ready=[];
    let okay=true;
    try {
      this.job.phase('preparing',c.name);
      for(const t of batch){this.c.clearIssue(t.key);this.c.operation(t.key,'preparing');}
      const before=await adapter.readLimitStates(ids,dir);
      for(const t of batch){
        try{
          const raw=before.get(String(t.id));
          if(!raw)throw new Error('下载器未返回该种子的原始限速状态');
          if(!sameLimit(raw.value,t.current)||this.owned[t.key]?.lastState&&!exactState(raw,this.owned[t.key].lastState))throw Object.assign(new Error(restore?'恢复前发现下载器限速被外部修改':'写入前值已变化，本轮跳过'),{limitIssue:'external'});
          t.raw=raw;ready.push(t);
        }catch(e){okay=false;this.fail(t,e);}
      }
      if(increasing&&!okay){for(const t of ready){t.p.execution='本批存在外部修改或未确认额度，暂缓提额';this.settle(t,'blocked');}this.job.persist(this.owned);return false;}
      const write=[];
      for(const t of ready){
        const record=this.owned[t.key];
        t.previousRecord=record?{...record}:null;
        if(!restore)this.owned[t.key]={...record,mode:this.mode,key:t.p.key,clientId:c.id,torrentId:t.id,name:t.p.name,direction:dir,baseline:record?record.baseline:t.raw.value,baselineState:record?.baselineState||t.raw,last:record?record.last:t.raw.value,conflict:false};
        const unchanged=restore?exactState(t.raw,t.state):sameLimit(t.raw.value,t.target);
        if(unchanged){this.confirm(t,t.raw);this.settle(t,'unchanged');}
        else{Object.assign(this.owned[t.key],{pending:restore?t.state.value:t.target,...(restore?{pendingRestore:true}:{})});write.push(t);}
      }
      // One atomic durable checkpoint for this bounded batch, before any native write.
      this.job.phase('writing',c.name);for(const t of write)this.c.operation(t.key,'writing');
      this.job.persist(this.owned);
      if(write.length){
        const groups=new Map(),attempted=[];
        for(const t of write){const signature=JSON.stringify(restore?t.state:t.target);if(!groups.has(signature))groups.set(signature,[]);groups.get(signature).push(t);}
        let stop=false;
        for(const group of groups.values()){
          if(stop){for(const t of group){if(t.previousRecord)this.owned[t.key]=t.previousRecord;else delete this.owned[t.key];t.p.execution='本批写入失败，暂缓后续提额';this.settle(t,'blocked');t.blocked=true;}continue;}
          try{
            this.job.phase('writing',c.name);
            if(restore&&group[0].record.baselineState)await adapter.restoreLimitStates(group.map(t=>t.id),dir,group[0].state);else await adapter.setLimits(group.map(t=>t.id),dir,restore?group[0].state.value:group[0].target);
            if(increasing){
              this.job.phase('confirming',c.name);for(const t of group)this.c.operation(t.key,'confirming');
              const after=await adapter.readLimitStates(group.map(t=>t.id),dir);
              for(const t of group){const raw=after.get(String(t.id));if(!raw||!sameLimit(raw.value,t.target)){okay=false;stop=true;this.fail(t,new Error('下载器回读值与目标不符'));t.failed=true;}else{this.confirm(t,raw);this.settle(t,'confirmed');}}
            }else attempted.push(...group);
          }
          catch(e){okay=false;for(const t of group){this.fail(t,e);t.failed=true;}if(increasing)stop=true;}
        }
        if(attempted.length)try{
          this.job.phase('confirming',c.name);for(const t of attempted)this.c.operation(t.key,'confirming');
          const after=await adapter.readLimitStates(attempted.map(t=>t.id),dir);
          for(const t of attempted){
            const raw=after.get(String(t.id));
            if(!raw||!sameLimit(raw.value,restore?t.state.value:t.target)||restore&&!exactState(raw,t.state)){okay=false;this.fail(t,new Error(restore?'原始限速开关或保留值未完整恢复':'下载器回读值与目标不符'));t.failed=true;}
            else{this.confirm(t,raw);this.settle(t,'confirmed');}
          }
        }catch(e){okay=false;for(const t of attempted){this.fail(t,e);t.failed=true;}}
      }
      const confirmed=ready.filter(t=>!t.failed&&!t.blocked);
      if(confirmed.length)this.c.store.event(restore?'批量恢复已确认':'批量限速已确认',`${c.name} · ${dir==='upload'?'上传':'下载'} · ${confirmed.length} 项`,'success',{code:restore?'limit.batch_restored':'limit.batch_confirmed',clientId:c.id,direction:dir,count:confirmed.length,jobId:this.job.value?.id,torrents:confirmed.map(t=>({id:t.id,name:t.p?.name||t.record?.name,target:t.restore?t.state.value:t.target}))});
      this.job.persist(this.owned);return okay;
    }catch(e){for(const t of batch)this.fail(t,e);this.job.persist(this.owned);return false;}
    finally{for(const t of batch)this.c.operation(t.key,null);}
  }
  confirm(t,raw) {
    if(t.restore){delete this.owned[t.key];this.c.clearIssue(t.key);}
    else {const r=this.owned[t.key];r.last=raw.value;r.lastState={...raw};r.time=Date.now();delete r.pending;delete r.pendingRestore;delete r.issue;delete r.issueMessage;delete r.issueTime;t.p.execution='已回读确认';}
    const rt=this.runtime.get(t.c.id)?.get(String(t.id));if(rt)rt[`${t.dir}Limit`]=raw.value;
  }
}
