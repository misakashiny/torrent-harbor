import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {QbAdapter,TrAdapter,toSnake} from '../server/adapters.mjs';
async function serve(handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return {url:'http://127.0.0.1:'+s.address().port,close:()=>new Promise(r=>s.close(r))};}
test('QB 批量 HTTP 精确发送哈希列表，独立回读，缺项不当作不限速；空列表拒绝',async()=>{
  const values={a:170000,b:0};let writes=0;
  const m=await serve(async(req,res)=>{if(req.url.endsWith('/auth/login')){res.setHeader('Set-Cookie','SID=batch');res.end('Ok.');return;}let raw='';for await(const ch of req)raw+=ch;const p=new URLSearchParams(raw);assert.equal(req.method,'POST');assert.equal(p.get('hashes'),'a|b');if(req.url.includes('setUploadLimit')){writes++;for(const id of p.get('hashes').split('|'))values[id]=Number(p.get('limit'));res.end();}else res.end(JSON.stringify(values));});
  try{const a=new QbAdapter({url:m.url},'');assert.equal((await a.readLimitStates(['a','b'],'upload')).get('b').value,null);await a.setLimits(['a','b'],'upload',123456);assert.deepEqual([...await a.readLimitStates(['a','b'],'upload')],[['a',{value:123456}],['b',{value:123456}]]);delete values.b;assert.equal((await a.readLimitStates(['a','b'],'upload')).has('b'),false);await assert.rejects(a.setLimits([],'upload',null),/为空/);await assert.rejects(a.readLimitStates([],'upload'),/为空/);assert.equal(writes,1);}finally{await m.close();}
});
for(const modern of [false,true])test(`TR ${modern?'新':'旧'} RPC 批量哈希、方向字段与禁用记忆值完整恢复`,async()=>{
  const state=new Map([['a',{enabled:false,amount:77}],['b',{enabled:true,amount:123}]]);let writes=0;
  const m=await serve(async(req,res)=>{let raw='';for await(const ch of req)raw+=ch;const b=JSON.parse(raw),p=b.params||b.arguments;assert.deepEqual(p.ids,['a','b']);const field=k=>modern?toSnake(k):k;let result={};if(b.method==='torrent-get'||b.method==='torrent_get')result={torrents:[...state].map(([id,r])=>({[field('hashString')]:id,[field('uploadLimited')]:r.enabled,[field('uploadLimit')]:r.amount}))};else{writes++;for(const r of state.values()){r.enabled=p[field('uploadLimited')];if(Object.hasOwn(p,field('uploadLimit')))r.amount=p[field('uploadLimit')];}}res.end(JSON.stringify(modern?{jsonrpc:'2.0',id:1,result}:{result:'success',arguments:result}));});
  try{const a=new TrAdapter({url:m.url},'');a.modern=modern;const before=await a.readLimitStates(['a','b'],'upload');assert.deepEqual(before.get('a'),{enabled:false,amount:77,value:null});await a.setLimits(['a','b'],'upload',null);assert.equal(state.get('b').amount,123);await a.restoreLimitStates(['a','b'],'upload',{enabled:false,amount:77,value:null});assert.deepEqual((await a.readLimitStates(['a','b'],'upload')).get('b'),{enabled:false,amount:77,value:null});await assert.rejects(a.setLimits([],'upload',null),/为空/);await assert.rejects(a.restoreLimitStates([],'upload',before.get('a')),/无效/);assert.equal(writes,2);}finally{await m.close();}
});
