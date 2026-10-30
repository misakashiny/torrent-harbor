import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { UpdateManager, repositoryName, isNewer } from '../server/updates.mjs';
test('版本比较覆盖正式版、预发布与数字顺序',()=>{
  assert(isNewer('v1.1.0','1.1.0-rc.1'));assert(isNewer('1.10.0','1.9.9'));assert(!isNewer('v1.1.0','1.1.0'));assert(!isNewer('1.1.0-rc.1','1.1.0'));
  assert.equal(repositoryName('https://github.com/owner/project.git'),'owner/project');assert.throws(()=>repositoryName('owner/project/../../evil'));
});
test('正式 Release 检查、确认、队列互斥、来源固定与恢复前置条件',async()=>{
  const root=mkdtempSync(join(tmpdir(),'harbor-updates-'));const store=new Store(root);const requests=[];
  try{
    store.set('settings',{controlEnabled:false});store.set('managed',{});
    const release={id:42,tag_name:'v1.1.0',name:'v1.1.0',body:'Release notes',published_at:'2026-10-30',draft:false,prerelease:false,assets:[{id:8,name:'torrent-harbor-1.1.0-linux-amd64.tar.gz',size:1234},{id:9,name:'torrent-harbor-1.1.0-linux-amd64.tar.gz.sha256'}]};
    const manager=new UpdateManager(store,{version:'1.1.0-rc.1',directory:root,platform:'linux-amd64',fetcher:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>release};}});
    manager.configure({token:'secret-read-token'});
    const state=await manager.check();assert(state.available);assert(state.latest.assetReady);assert.equal(requests[0].options.headers.Authorization,'Bearer secret-read-token');assert(!JSON.stringify(state).includes('secret-read-token'));
    assert.throws(()=>manager.plan(),/未连接/);
    writeFileSync(join(root,'agent.json'),JSON.stringify({heartbeat:Date.now(),repository:'other/repository',previousVersion:'1.0.0'}));assert.throws(()=>manager.plan(),/不一致/);
    writeFileSync(join(root,'agent.json'),JSON.stringify({heartbeat:Date.now(),repository:state.repository,previousVersion:'1.0.0'}));
    store.set('settings',{controlEnabled:true});assert.throws(()=>manager.plan(),/释放接管/);store.set('settings',{controlEnabled:false});
    store.set('managed',{one:{last:1000}});assert.throws(()=>manager.plan(),/释放接管/);store.set('managed',{});
    const plan=manager.plan();assert.equal(plan.tag,'v1.1.0');assert.throws(()=>manager.queue('wrong'),/过期/);
    const queued=manager.queue(plan.id);const request=JSON.parse(readFileSync(join(root,'request.json')));assert.equal(request.id,queued.jobId);assert.equal(request.releaseId,42);assert.equal(manager.status().job.state,'queued');assert.throws(()=>manager.plan(),/正在执行/);assert.throws(()=>manager.configure({repository:'other/repo'}),/进行中/);
    writeFileSync(join(root,'status.json'),JSON.stringify({id:queued.jobId,state:'succeeded'}));const rollback=manager.plan('rollback');assert.equal(rollback.tag,'v1.0.0');assert.match(rollback.notes,/快照/);
    store.set('updatePlan',{...rollback,expires:Date.now()-1});assert.throws(()=>manager.queue(rollback.id),/过期/);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('检查失败保留已知版本并给出可读错误',async()=>{
  const root=mkdtempSync(join(tmpdir(),'harbor-update-error-'));const store=new Store(root);
  try{const manager=new UpdateManager(store,{version:'1.1.0',fetcher:async()=>({ok:false,status:404})});const result=await manager.check();assert.match(result.error,/尚无正式发布/);assert.equal(result.available,false);}finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('GitHub 连接短暂中断会重试，权限错误不会重复请求',async()=>{
  const root=mkdtempSync(join(tmpdir(),'harbor-update-retry-'));const store=new Store(root);let calls=0;
  try{
    const manager=new UpdateManager(store,{version:'1.1.0',fetcher:async()=>{calls++;if(calls===1)throw new TypeError('temporary TLS failure');return {ok:true,status:200,json:async()=>({id:1,tag_name:'v1.1.1',assets:[]})};}});
    assert.equal((await manager.check()).error,'');assert.equal(calls,2);
    calls=0;manager.fetcher=async()=>{calls++;return {ok:false,status:403};};assert.match((await manager.check()).error,/请求受限/);assert.equal(calls,1);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
