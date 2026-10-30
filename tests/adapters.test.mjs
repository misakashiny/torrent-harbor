import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { QbAdapter, TrAdapter, toSnake, validateUrl } from '../server/adapters.mjs';
async function mock(handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};}
const send=(res,data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
test('QB HTTP：SID 登录、全 Tracker 元数据、字节单位与写后回读',async()=>{
  const limits={upload:0,download:0};let reauth=0;
  const m=await mock(async(req,res)=>{
    const u=new URL(req.url,'http://local');
    if(u.pathname==='/api/v2/auth/login'){res.setHeader('Set-Cookie','SID=mock-session; HttpOnly');res.end('Ok.');return;}
    if(req.headers.cookie!=='SID=mock-session'){res.writeHead(403);res.end();return;}
    if(u.pathname.endsWith('/torrents/info'))return send(res,[{hash:'abc',name:'test',progress:.5,size:1000,upspeed:100,dlspeed:200,up_limit:limits.upload,dl_limit:limits.download,tags:'电影, 保种',state:'downloading'}]);
    if(u.pathname.endsWith('/transfer/info'))return send(res,{up_info_speed:100,dl_info_speed:200,up_rate_limit:1000000,dl_rate_limit:0});
    if(u.pathname.endsWith('/app/version')){res.end('v5.0.0');return;}
    if(u.pathname.endsWith('/transfer/speedLimitsMode'))return send(res,1);
    if(u.pathname.endsWith('/torrents/trackers'))return send(res,[{url:'https://first.example/announce?passkey=secret'},{url:'https://second.example/announce'},{url:'DHT'}]);
    if(/\/set(?:Upload|Download)Limit$/.test(u.pathname)){let b='';for await(const chunk of req)b+=chunk;const d=new URLSearchParams(b);limits[u.pathname.includes('Upload')?'upload':'download']=Number(d.get('limit'));res.end();return;}
    if(/\/(?:upload|download)Limit$/.test(u.pathname))return send(res,{abc:limits[u.pathname.includes('upload')?'upload':'download']});
    res.writeHead(404);res.end();
  });
  try{const a=new QbAdapter({url:m.url,username:'admin'},'mock');const s=await a.snapshot();assert.deepEqual(s.torrents[0].hosts,['first.example','second.example']);assert.deepEqual(s.torrents[0].tags,['电影','保种']);assert.equal(s.native.alternative,true);assert.equal(s.torrents[0].uploadLimit,null);await a.setLimit('abc','upload',123456);assert.equal(await a.readLimit('abc','upload'),123456);await a.setLimit('abc','upload',null);assert.equal(await a.readLimit('abc','upload'),null);assert.ok(!JSON.stringify(s).includes('passkey'));}finally{await m.close();}
});
for(const modern of [false,true])test(`TR HTTP：${modern?'JSON-RPC 2.0':'旧 RPC'}、409 握手、单位与启用状态`,async()=>{
  const state={uploadLimited:false,uploadLimit:0,downloadLimited:true,downloadLimit:0};let handshake=0,modernSeen=false;
  const row={id:7,hashString:'hash7',name:'test',percentDone:1,totalSize:1000,uploadedEver:2000,downloadedEver:1000,uploadRatio:2,rateUpload:100,rateDownload:0,labels:['保种'],trackers:[{announce:'https://tr.example/announce?passkey=secret'}],status:6,error:0,...state};
  const m=await mock(async(req,res)=>{
    if(req.headers['x-transmission-session-id']!=='mock-tr-session'){handshake++;res.writeHead(409,{'X-Transmission-Session-Id':'mock-tr-session'});res.end();return;}
    assert.equal(req.headers.authorization,`Basic ${Buffer.from('user:mock').toString('base64')}`);
    let raw='';for await(const ch of req)raw+=ch;const b=JSON.parse(raw),modernRequest=b.jsonrpc==='2.0';modernSeen ||= modernRequest;
    const method=b.method.replaceAll('_','-'),args=modernRequest?b.params:b.arguments;
    let result={};
    if(method==='session-get')result={version:modern?'4.1.0':'4.0.6',units:modern?{speed_bytes:1000}:{'speed-bytes':1000}};
    if(method==='torrent-get'){Object.assign(row,state);const entries=Object.entries(row).map(([k,v])=>[modernRequest?toSnake(k):k,v]);result={torrents:[Object.fromEntries(entries)]};}
    if(method==='session-stats')result=modernRequest?{upload_speed:100,download_speed:0}:{uploadSpeed:100,downloadSpeed:0};
    if(method==='torrent-set'){for(const k of Object.keys(state)){const key=modernRequest?toSnake(k):k;if(key in args)state[k]=args[key];}}
    return send(res,modernRequest?{jsonrpc:'2.0',id:1,result}:{result:'success',arguments:result});
  });
  try{const a=new TrAdapter({url:m.url,username:'user'},'mock');const s=await a.snapshot();assert.equal(handshake,1);assert.equal(modernSeen,modern);assert.equal(s.torrents[0].id,'hash7');assert.equal(s.torrents[0].downloadLimit,0);assert.equal(await a.readLimit(7,'download'),0);assert.deepEqual(s.torrents[0].hosts,['tr.example']);state.uploadLimit=77;const original=await a.readLimitState(7,'upload');assert.deepEqual(original,{enabled:false,amount:77,value:null});await a.setLimit(7,'upload',123000);assert.equal(state.uploadLimit,123);assert.equal(await a.readLimit(7,'upload'),123000);await a.restoreLimitState(7,'upload',original);assert.equal(state.uploadLimited,false);assert.equal(state.uploadLimit,77);assert.equal(await a.readLimit(7,'upload'),null);assert.equal(a.quantize(123456),modern?123000:96000);assert.equal(a.quantize(32768),modern?32000:32000);assert.equal(a.quantize(32767),modern?32000:0);assert.equal(!!a.limitProblem(16000),!modern);}finally{await m.close();}
});
test('拒绝 URL 内嵌凭证、查询参数和非 HTTP 协议',()=>{for(const v of ['file:///secret','http://user:pass@host/','http://host/?password=x'])assert.throws(()=>validateUrl(v));assert.equal(validateUrl('https://host/path/'),'https://host/path');});
