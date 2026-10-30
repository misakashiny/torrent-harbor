import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TrafficStore,trafficRanges } from '../server/traffic.mjs';
import { LogStore,redact } from '../server/logs.mjs';
import { reorderRules,ruleRevision } from '../server/rule-order.mjs';
import { validateIcon,siteIcons } from '../server/site-icons.mjs';
import { validPageSize,formatBytes } from '../web/format.mjs';
const client={id:'a',name:'A',type:'qb',url:'http://local',username:'x'};
test('流量按原生累计差值记录，首次不补算历史，六种时段与分钟边界正确',()=>{
  const db=new DatabaseSync(':memory:'),s=new TrafficStore(db),now=1800000000000;
  s.record('real',client,{upload:1000,download:2000,lifetime:true,source:'qb'},now);
  s.record('real',client,{upload:7000,download:14000,lifetime:true,source:'qb'},now+60000);
  for(const range of Object.keys(trafficRanges)){const r=s.totals('real',[client],range,new Map(),now+60000);assert.equal(r.upload,6000);assert.equal(r.download,12000);assert.equal(r.partial,true);}
  assert.equal(s.totals('real',[client],'all',new Map(),now+60000).upload,7000);
  const half=s.totals('real',[client],'1h',new Map(),now+3600000+30000);assert.equal(half.upload,3000);
  assert.equal(s.totals('demo',[client],'all').upload,null);assert.throws(()=>s.totals('real',[client],'bad'));
  db.close();
});
test('计数重置、同步长中断、来源和连接改变不会制造尖峰；离线与缺失明确标记',()=>{
  const db=new DatabaseSync(':memory:'),s=new TrafficStore(db),n=1800000000000;
  const record=(upload,time,source='qb',c=client)=>s.record('real',c,{upload,download:upload,lifetime:true,source},time);
  record(100,n);record(200,n+10000);record(5000,n+3600000);record(10,n+3610000);record(1010,n+3620000);
  const r=s.totals('real',[client],'7d',new Map(),n+3620000);assert.equal(r.upload,1100);assert.equal(r.clients[0].gaps,2);assert.equal(r.partial,true);
  record(100000,n+3630000,'session');assert.equal(s.totals('real',[client],'7d',new Map(),n+3630000).upload,1100);
  record(200000,n+3640000,'qb',{...client,url:'http://changed'});assert.equal(s.totals('real',[client],'7d',new Map(),n+3640000).upload,0);
  const incomplete=s.totals('real',[client,{...client,id:'missing'}],'all',new Map([[client.id,{online:false}]]),n+3640000);assert.equal(incomplete.partial,true);assert.equal(incomplete.clients[1].available,false);assert.equal(incomplete.clients[0].stale,true);
  assert.equal(s.record('real',client,{upload:NaN,download:1}),false);db.close();
});
test('日志合并重复错误、过滤分页和凭证隐藏',()=>{
  const db=new DatabaseSync(':memory:'),s=new LogStore(db),n=1800000000000;
  const log={level:'error',scope:'connection',code:'failed',message:'失败',context:{clientId:'a',password:'private',url:'https://u:p@tracker.test/abcdef0123456789abcdef0123456789?passkey=private',detail:'token=private Bearer private'}};
  s.write(log,n);s.write(log,n+1000);s.write({...log,scope:'http'},n+2000);
  const r=s.query({level:'error',scope:'connection',client:'a',q:'失败'});assert.equal(r.total,1);assert.equal(r.rows[0].repeats,2);assert.equal(r.rows[0].first_time,n);assert.ok(!JSON.stringify(r).includes('private'));assert.ok(!JSON.stringify(r).includes('u:p@'));assert.equal(s.query({q:'_no-such_%'}).total,0);assert.equal(s.query({pageSize:1}).rows.length,1);assert.throws(()=>s.query({from:'bad'}));assert.equal(redact({authorization:'secret'}).authorization,'[已隐藏]');db.close();
});
test('规则排序完整校验、原子优先级及冲突保护',()=>{
  const rules=[{id:'a',priority:10,name:'A',upload:100},{id:'b',priority:20,name:'B',upload:200}],revision=ruleRevision(rules);
  const sorted=reorderRules(rules,{ids:['b','a'],revision});assert.deepEqual(sorted.map(r=>[r.id,r.priority]),[['b',0],['a',1]]);assert.equal(sorted[0].upload,200);assert.equal(rules[0].priority,10);
  assert.throws(()=>reorderRules(rules,{ids:['a','a'],revision}));assert.throws(()=>reorderRules(rules,{ids:['a'],revision}));assert.throws(()=>reorderRules(rules,{ids:['b','a'],revision:'stale'}),{status:409});
});
test('站点图标仅允许本地清单；分页选项及大流量单位正确',()=>{
  assert.equal(siteIcons.length,333);assert.equal(validateIcon(siteIcons[0].id),siteIcons[0].id);assert.equal(validateIcon('auto'),'auto');assert.throws(()=>validateIcon('https://evil/a.svg'));assert.throws(()=>validateIcon('../secret.key'));
  for(const n of [25,50,100,200,300])assert.equal(validPageSize(String(n)),n);for(const n of [0,30,500,null])assert.equal(validPageSize(n),25);assert.equal(formatBytes(1024**4),'1 TiB');assert.equal(formatBytes(null),'—');
});
