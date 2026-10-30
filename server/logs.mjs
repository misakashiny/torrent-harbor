import { createHash } from 'node:crypto';
const secretKey=/password|passwd|passkey|secret|authorization|cookie|token|credential|api.?key/i;
export function redact(value, depth=0, arrayLimit=100) {
  if(depth>8)return '[已省略]';
  if(Array.isArray(value))return value.slice(0,arrayLimit).map(v=>redact(v,depth+1,arrayLimit));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,secretKey.test(k)?'[已隐藏]':redact(v,depth+1,arrayLimit)]));
  if(typeof value!=='string')return value??null;
  return value.slice(0,12000).replace(/https?:\/\/[^\s<>"']+/gi,raw=>{try{const u=new URL(raw);u.username='';u.password='';if(u.search)u.search='?[已隐藏]';u.pathname=u.pathname.replace(/[a-f\d]{24,}/gi,'[已隐藏]');return u.href;}catch{return '[地址已隐藏]';}}).replace(/\b(Bearer|Basic)\s+[\w+/=._-]+/gi,'$1 [已隐藏]').replace(/((?:password|passwd|passkey|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;&]+/gi,'$1[已隐藏]');
}
export class LogStore {
  constructor(db) {
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS diagnostic_logs (id INTEGER PRIMARY KEY, time INTEGER, first_time INTEGER, level TEXT, scope TEXT, code TEXT, message TEXT, context TEXT, repeats INTEGER DEFAULT 1, fingerprint TEXT);
      CREATE INDEX IF NOT EXISTS logs_time ON diagnostic_logs(time);
      CREATE INDEX IF NOT EXISTS logs_fingerprint ON diagnostic_logs(fingerprint,time);`);
  }
  write({level='info',scope='system',code='event',message,context={}},now=Date.now()) {
    level=['info','success','warning','error'].includes(level)?level:'info';
    const safe=JSON.stringify(redact(context)), text=String(redact(message||'')), fingerprint=createHash('sha256').update(JSON.stringify([level,scope,code,text,safe])).digest('hex');
    const old=this.db.prepare('SELECT id FROM diagnostic_logs WHERE fingerprint=? AND time>=? ORDER BY id DESC LIMIT 1').get(fingerprint,now-60000);
    if(old)this.db.prepare('UPDATE diagnostic_logs SET time=?,repeats=repeats+1 WHERE id=?').run(now,old.id);
    else this.db.prepare('INSERT INTO diagnostic_logs(time,first_time,level,scope,code,message,context,fingerprint) VALUES(?,?,?,?,?,?,?,?)').run(now,now,level,scope,code,text,safe,fingerprint);
    if(!this.pruned||now-this.pruned>60000) { this.db.prepare('DELETE FROM diagnostic_logs WHERE time<? OR id<=COALESCE((SELECT MAX(id) FROM diagnostic_logs),0)-10000').run(now-30*86400000);this.pruned=now; }
  }
  query({level='',scope='',q='',client='',from='',to='',page=1,pageSize=50}={}) {
    const where=[], args=[];
    if(level==='attention')where.push("level IN ('warning','error')");else if(level){where.push('level=?');args.push(String(level));}if(scope){where.push('scope=?');args.push(String(scope));}
    if(q){where.push('(message LIKE ? ESCAPE \'\\\' OR context LIKE ? ESCAPE \'\\\' OR code LIKE ? ESCAPE \'\\\')');const s='%'+String(q).slice(0,200).replace(/[\\%_]/g,'\\$&')+'%';args.push(s,s,s);}
    if(client){where.push("json_extract(context,'$.clientId')=?");args.push(String(client));}
    for(const [v,op] of [[from,'>='],[to,'<=']])if(v){const t=Number(v);if(!Number.isFinite(t)||t<0)throw new Error('日志时间无效');where.push(`time${op}?`);args.push(t);}
    page=Math.max(1,Math.min(100000,Math.floor(Number(page)||1)));pageSize=Math.max(1,Math.min(200,Math.floor(Number(pageSize)||50)));
    const clause=where.length?' WHERE '+where.join(' AND '):'', total=this.db.prepare('SELECT COUNT(*) AS n FROM diagnostic_logs'+clause).get(...args).n;
    page=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
    const rows=this.db.prepare('SELECT * FROM diagnostic_logs'+clause+' ORDER BY time DESC,id DESC LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize).map(({fingerprint,context,...r})=>({...r,context:JSON.parse(context)}));
    return {rows,total,page,pageSize};
  }
}
