import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { Store } from '../server/store.mjs';
test('300 个不同任务的整页批量标签与临时额度，参数失败不会部分保存',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'harbor-bulk-')),store=new Store(directory);
  store.set('clients',Array.from({length:30},(_,i)=>({id:'demo-bulk-'+i,name:'模拟下载器 '+i,type:'qb',demo:true,enabled:true,url:'',username:''})));
  for(let i=0;i<450;i++)store.logs.write({scope:'system',code:'fixture.'+i,message:'模拟诊断 '+i},Date.now()-i*1000);
  store.close();
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATA_DIR:directory,PORT:String(port),HOST:'127.0.0.1',ADMIN_PASSWORD:'bulk-test-local-only'},stdio:'ignore'});let cookie='';
  async function request(path,method='GET',body,attempt=0){const r=await fetch(`http://127.0.0.1:${port}/api/`+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const b=await r.json();if(r.status===409&&b.error?.startsWith('正在同步')&&attempt<30){await new Promise(r=>setTimeout(r,50));return request(path,method,body,attempt+1);}if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:b};}
  try {
    let ready=false;for(let i=0;i<100;i++){try{if((await request('health')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
    assert.equal((await request('auth/login','POST',{password:'bulk-test-local-only'})).status,200);const state=(await request('state')).body;assert.equal(state.torrents.length,360);const keys=state.torrents.slice(0,300).map(t=>t.key);
    assert.equal((await request('labels','PUT',{keys,tags:['整页300']})).status,200);assert.equal((await request('state')).body.torrents.filter(t=>t.localTags.includes('整页300')).length,300);
    assert.equal((await request('override','POST',{keys,upload:1048576,download:null,minutes:30,weight:2})).status,200);assert.equal((await request('state')).body.plan.filter(p=>p.override).length,300);
    assert.equal((await request('labels','PUT',{keys:[...keys,'missing-task'],tags:['不应保存']})).status,400);assert.equal((await request('state')).body.torrents.filter(t=>t.localTags.includes('不应保存')).length,0);
    assert.equal((await request('override','POST',{keys,clear:true})).status,200);assert.equal((await request('state')).body.plan.filter(p=>p.override).length,0);assert.equal((await request('state')).body.settings.controlEnabled,false);
    const latest=(await request('logs?scope=system')).body.rows[0],exported=(await request('diagnostics?scope=system&page=2')).body;
    assert.equal(exported.logs.length,200);assert.equal(exported.logs[0].id,latest.id);assert.ok(exported.logs.every(l=>l.scope==='system'));
  } finally {const exited=once(child,'exit');child.kill();await exited;rmSync(directory,{recursive:true,force:true});}
});
