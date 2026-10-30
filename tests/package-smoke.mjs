import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve,join } from 'node:path';
import { existsSync,mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
const directory=resolve(process.argv[2]||'.');
assert.ok(!existsSync(join(directory,'node_modules')),'分发检查目录不应包含开发依赖');
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const data=mkdtempSync(join(tmpdir(),'harbor-package-'));
const child=spawn(process.execPath,['server/index.mjs'],{cwd:directory,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:data,ADMIN_PASSWORD:''},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
const base=`http://127.0.0.1:${port}`;
try{
  let started=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){started=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.ok(started,output);
  const html=await(await fetch(base)).text();assert.ok(html.includes('Torrent Harbor'));
  const script=html.match(/src="([^"]+\.js)"/)[1],css=html.match(/href="([^"]+\.css)"/)[1];
  assert.equal((await fetch(base+script)).status,200);assert.equal((await fetch(base+css)).status,200);
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'isolated-package-test'})});assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0];
  const state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();
  assert.equal(state.clients.length,3);assert.equal(state.torrents.length,36);assert.equal(state.settings.controlEnabled,false);
  console.log(JSON.stringify({date:'2026-10-30',result:'passed',node:process.version,checks:{withoutNodeModules:true,health:true,builtHtml:true,builtJavaScript:true,builtCss:true,firstRunSetup:true,authenticatedState:true,demoClients:3,demoTorrents:36,controlInitiallyDisabled:true},scope:'解压分发包的 Windows Node.js 本地启动检查，不代表 Docker 或真实下载器验收'},null,2));
}finally{const exit=once(child,'exit');child.kill();await exit;}
