import { randomUUID } from 'node:crypto';

// Progress is separate from user settings. A persisted running job is never proof
// that a worker survived a restart; its pending limits still require reconciliation.
export class ControlJob {
  constructor(controller) { this.c=controller;this.value=controller.store.get('controlJob');if(this.value?.status==='running')this.value={...this.value,status:'interrupted',phase:'interrupted',ended:Date.now()}; }
  start(kind,tasks) {
    if(!tasks.length)return false;
    this.value={id:randomUUID(),mode:this.c.store.get('settings').mode,kind,status:'running',phase:'preparing',total:tasks.length,torrents:new Set(tasks.map(t=>t.p?.key||t.record?.key||t.key)).size,processed:0,confirmed:0,unchanged:0,failed:0,conflict:0,blocked:0,started:Date.now(),updated:Date.now(),clientName:''};
    this.persist();return true;
  }
  phase(phase,clientName='') { if(this.value?.status!=='running')return;Object.assign(this.value,{phase,clientName,updated:Date.now()});this.c.limitRevision++; }
  count(kind,n=1) { if(this.value?.status!=='running')return;this.value[kind]+=n;this.value.processed+=n;this.value.updated=Date.now();this.c.limitRevision++; }
  persist(owned) {
    const values={...(owned?{managed:owned}:{}),...(this.value?{controlJob:this.value}:{})};
    if(this.c.store.setMany)this.c.store.setMany(values);else for(const [k,v]of Object.entries(values))this.c.store.set(k,v);
  }
  finish(error) {
    if(this.value?.status!=='running')return;
    const remaining=this.value.total-this.value.processed;
    if(remaining>0){this.value.blocked+=remaining;this.value.processed+=remaining;}
    Object.assign(this.value,{status:error?'interrupted':this.value.failed+this.value.conflict+this.value.blocked?'attention':'completed',phase:error?'interrupted':'finished',ended:Date.now(),updated:Date.now(),...(error?{error:String(error.message||error)}:{})});
    this.persist();this.c.limitRevision++;
  }
  snapshot() { return this.value?.mode===this.c.store.get('settings').mode?{...this.value}:null; }
}
