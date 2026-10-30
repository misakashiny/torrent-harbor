import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('应用 HTTP 全流程：认证、配置、标签、接管恢复及重启持久化',async t=>{
  const tmp=mkdtempSync(join(tmpdir(),'harbor-http-'));
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const base=`http://127.0.0.1:${port}`;let child,cookie='',output='';
  async function start(){child=spawn(process.execPath,['server/index.mjs'],{cwd:resolve('.'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:tmp,ADMIN_PASSWORD:''},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await wait(50);}throw new Error('应用启动失败：'+output);}
  async function request(path,method='GET',payload,headers={},attempt=0){const res=await fetch(base+'/api/'+path,{method,headers:{Cookie:cookie,...(payload!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});const body=await res.json();if(res.status===409&&body.error?.startsWith('正在同步')&&attempt<30){await wait(40);return request(path,method,payload,headers,attempt+1);}const sid=res.headers.get('set-cookie');if(sid)cookie=sid.split(';')[0];return {status:res.status,body};}
  try{
    await start();
    await t.test('未设置管理员时可见初始化状态，其他接口需认证',async()=>{assert.equal((await request('auth/status')).body.setup,true);assert.equal((await request('state')).status,401);assert.equal((await request('updates')).status,401);});
    await t.test('拒绝跨站修改和弱密码，初始化只能执行一次',async()=>{assert.equal((await request('auth/setup','POST',{password:'test-password-strong'},{Origin:'http://evil.invalid'})).status,403);assert.equal((await request('auth/setup','POST',{password:'123'})).status,400);assert.equal((await request('auth/setup','POST',{password:'test-password-strong'})).status,200);assert.equal((await request('auth/setup','POST',{password:'other-password'})).status,409);});
    await t.test('更新接口需要身份验证并校验来源与安装条件',async()=>{assert.equal((await request('updates')).status,200);assert.equal((await request('updates/config','PUT',{repository:'invalid'})).status,422);assert.equal((await request('updates/plan','POST',{action:'update'})).status,422);});
    let state=(await request('state')).body;const key=state.torrents[0].key;
    await t.test('演示数据与真实环境隔离，状态包含可解释计划',async()=>{assert.equal(state.settings.mode,'demo');assert.equal(state.clients.length,3);assert.equal(state.torrents.length,36);assert.equal(state.managed.length,0);assert.ok(state.plan[0].matchedRules.length);});
    await t.test('流量、日志与诊断需要登录，诊断无凭证，时段可切换',async()=>{
      for(const range of ['1h','12h','24h','3d','7d','all']){const r=await request('traffic?range='+range);assert.equal(r.status,200);assert.equal(r.body.clients.length,3);assert.ok(r.body.upload>=0);}
      assert.equal((await request('traffic?range=bad')).status,400);assert.ok((await request('logs')).body.total>0);assert.equal((await request('diagnostics')).body.version,state.version);
    });
    await t.test('拖动排序原子保存，旧页面的排序被拒绝且不改变规则',async()=>{
      state=(await request('state')).body;const ids=[...state.rules].reverse().map(r=>r.id),payload={ids,revision:state.ruleRevision};
      assert.equal((await request('rules/order','PUT',payload)).status,200);const updated=(await request('state')).body;assert.deepEqual(updated.rules.map(r=>r.id),ids);assert.deepEqual(updated.rules.map(r=>r.priority),[0,1,2,3]);assert.equal((await request('rules/order','PUT',payload)).status,409);
    });
    await t.test('添加池与规则、预览命中、参数校验和引用保护',async()=>{
      const p=await request('pools','POST',{name:'测试池',upload:2000000,download:null,weight:1,color:'#123456'});assert.equal(p.status,200);
      const r={name:'测试规则',enabled:true,priority:1,poolId:p.body.id,tags:['测试标签'],hosts:[],upload:1000000,download:null,weight:1};
      assert.equal((await request('preview','POST',r)).body.matches.length,0);
      const saved=await request('rules','POST',r);assert.equal(saved.status,200);assert.equal((await request('pools/'+p.body.id,'DELETE')).status,400);
      assert.equal((await request('rules','POST',{...r,hosts:['site.example/announce?passkey=secret']})).status,400);
      assert.equal((await request('pools','POST',{name:'坏参数',upload:-1,weight:1})).status,400);
      assert.equal((await request('rules/'+saved.body.id,'DELETE')).status,200);assert.equal((await request('pools/'+p.body.id,'DELETE')).status,200);
    });
    await t.test('本地标签与临时设置持久化，不覆盖原生标签',async()=>{assert.equal((await request('labels','PUT',{keys:[key],tags:['测试标签']})).status,200);assert.equal((await request('override','POST',{keys:[key],weight:3,minutes:30,upload:1500000,download:null})).status,200);state=(await request('state')).body;const torrent=state.torrents.find(x=>x.key===key);assert.ok(torrent.localTags.includes('测试标签'));assert.ok(torrent.nativeTags.length);assert.equal(state.plan.find(p=>p.key===key).weight,3);});
    await t.test('凭证不会出现在状态或配置导出中',async()=>{const created=await request('clients','POST',{name:'未连接的真实实例',type:'qb',url:'http://127.0.0.1:65534',username:'user',password:'mock-private-credential',enabled:false});assert.equal(created.status,200);assert.ok(!JSON.stringify(created.body).includes('mock-private-credential'));state=(await request('state')).body;assert.equal(state.clients.length,3);const exported=await request('export');assert.ok(!JSON.stringify(exported.body).includes('mock-private-credential'));assert.equal(exported.body.settings.controlEnabled,false);});
    await t.test('演示接管实际改变模拟下载器并确认，释放后恢复',async()=>{assert.equal((await request('settings','PUT',{controlEnabled:true})).status,200);for(let i=0;i<100;i++){await wait(100);state=(await request('state')).body;if(state.managed.length)break;}assert.ok(state.managed.length>0);assert.ok(state.managed.every(m=>m.last>0));assert.equal((await request('settings','PUT',{mode:'real'})).status,400);const release=await request('release','POST',{});assert.equal(release.body.remaining,0);assert.equal((await request('state')).body.settings.controlEnabled,false);});
    await t.test('重启使会话失效，密码、标签和配置继续保留',async()=>{const exit=once(child,'exit');child.kill();await exit;await start();assert.equal((await request('state')).status,401);assert.equal((await request('auth/login','POST',{password:'wrong'})).status,401);assert.equal((await request('auth/login','POST',{password:'test-password-strong'})).status,200);state=(await request('state')).body;assert.ok(state.torrents.find(t=>t.key===key).localTags.includes('测试标签'));assert.ok(state.configuredClients.some(c=>c.name==='未连接的真实实例'));});
    await t.test('切换真实环境不混入演示任务，也不自动开启接管',async()=>{assert.equal((await request('settings','PUT',{mode:'real'})).status,200);state=(await request('state')).body;assert.equal(state.clients.length,0);assert.equal(state.torrents.length,0);assert.equal(state.settings.controlEnabled,false);});
  }finally{if(child&&!child.killed){const exit=once(child,'exit');child.kill();await exit;}rmSync(tmp,{recursive:true,force:true});}
});
