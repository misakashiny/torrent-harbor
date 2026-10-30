import { createHash } from 'node:crypto';

export const trafficRanges = { '1h':3600000, '12h':43200000, '24h':86400000, '3d':259200000, '7d':604800000 };
const minute = 60000;
export class TrafficStore {
  constructor(db) {
    this.db=db;
    db.exec(`CREATE TABLE IF NOT EXISTS traffic_clients (mode TEXT, client TEXT, identity TEXT, source TEXT, since INTEGER, time INTEGER, upload REAL, download REAL, lifetime INTEGER, PRIMARY KEY(mode,client));
      CREATE TABLE IF NOT EXISTS traffic_minutes (mode TEXT, client TEXT, time INTEGER, upload REAL, download REAL, covered REAL, gaps INTEGER DEFAULT 0, PRIMARY KEY(mode,client,time));
      CREATE INDEX IF NOT EXISTS traffic_time ON traffic_minutes(mode,time);`);
  }
  record(mode, client, counters, now=Date.now(), maxGap=60000) {
    if(!counters || !['upload','download'].every(k=>Number.isFinite(counters[k])&&counters[k]>=0)) return false;
    const identity=createHash('sha256').update(JSON.stringify([client.type,client.url,client.username])).digest('hex');
    let old=this.db.prepare('SELECT * FROM traffic_clients WHERE mode=? AND client=?').get(mode,client.id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(old&&old.identity!==identity) { this.db.prepare('DELETE FROM traffic_minutes WHERE mode=? AND client=?').run(mode,client.id); old=null; }
      const elapsed=old ? now-old.time:0, reset=old&&(counters.upload<old.upload||counters.download<old.download);
      if(old&&elapsed>0&&old.source===counters.source) {
        const upload=Math.max(0,counters.upload-old.upload), download=Math.max(0,counters.download-old.download);
        const gap=elapsed>maxGap||reset;
        const add=this.db.prepare(`INSERT INTO traffic_minutes VALUES(?,?,?,?,?,?,?) ON CONFLICT(mode,client,time) DO UPDATE SET upload=upload+excluded.upload,download=download+excluded.download,covered=covered+excluded.covered,gaps=gaps+excluded.gaps`);
        if(gap) add.run(mode,client.id,Math.floor(now/minute)*minute,0,0,0,1);
        else for(let start=old.time;start<now;) {
          const bucket=Math.floor(start/minute)*minute, end=Math.min(now,bucket+minute), fraction=(end-start)/elapsed;
          add.run(mode,client.id,bucket,upload*fraction,download*fraction,end-start,0); start=end;
        }
      }
      this.db.prepare(`INSERT INTO traffic_clients VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(mode,client) DO UPDATE SET identity=excluded.identity,source=excluded.source,since=excluded.since,time=excluded.time,upload=excluded.upload,download=excluded.download,lifetime=excluded.lifetime`).run(mode,client.id,identity,counters.source||'unknown',old?.since??now,now,counters.upload,counters.download,counters.lifetime?1:0);
      if(!this.pruned||now-this.pruned>3600000) { this.db.prepare('DELETE FROM traffic_minutes WHERE time<?').run(now-8*86400000);this.pruned=now; }
      this.db.exec('COMMIT'); return true;
    } catch(e) { this.db.exec('ROLLBACK');throw e; }
  }
  totals(mode, clients, range='1h', runtime=new Map(), now=Date.now(), staleAfter=60000) {
    if(range!=='all'&&!trafficRanges[range]) throw new Error('统计时间范围无效');
    const start=range==='all'?null:now-trafficRanges[range];
    const rows=clients.map(c=>{
      const baseline=this.db.prepare('SELECT * FROM traffic_clients WHERE mode=? AND client=?').get(mode,c.id);
      const stale=!baseline||now-baseline.time>staleAfter||runtime.get(c.id)?.online===false;
      const result={id:c.id,name:c.name,since:baseline?.since??null,updated:baseline?.time??null,stale,available:!!baseline,upload:null,download:null,covered:0,gaps:0};
      if(!baseline)return result;
      if(range==='all')return {...result,available:!!baseline.lifetime,upload:baseline.lifetime?baseline.upload:null,download:baseline.lifetime?baseline.download:null,source:baseline.source};
      let upload=0,download=0,covered=0,gaps=0;
      for(const row of this.db.prepare('SELECT * FROM traffic_minutes WHERE mode=? AND client=? AND time>=? AND time<?').all(mode,c.id,Math.floor(start/minute)*minute,now)) {
        const end=Math.min(row.time+minute,baseline.time,now), begin=Math.max(row.time,baseline.since), length=end-begin;
        const overlap=Math.max(0,end-Math.max(begin,start)), factor=length>0?overlap/length:0;
        upload+=row.upload*factor;download+=row.download*factor;covered+=row.covered*factor;gaps+=row.gaps;
      }
      return {...result,upload,download,covered,gaps};
    });
    const available=rows.filter(r=>r.available), since=available.length?Math.max(...available.map(r=>r.since)):null;
    return {range,start,end:now,since,upload:available.length?available.reduce((n,r)=>n+(r.upload||0),0):null,download:available.length?available.reduce((n,r)=>n+(r.download||0),0):null,clients:rows,partial:available.length!==clients.length||rows.some(r=>r.stale)||(range!=='all'&&rows.some(r=>r.gaps||r.since>start||r.covered<Math.min(trafficRanges[range],now-r.since)-staleAfter)),granularity:'minute',source:range==='all'?'native-lifetime':'counter-deltas'};
  }
}
