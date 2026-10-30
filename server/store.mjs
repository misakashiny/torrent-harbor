import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { TrafficStore } from './traffic.mjs';
import { LogStore, redact } from './logs.mjs';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    const keyPath = join(directory, 'secret.key');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = readFileSync(keyPath);
    this.db = new DatabaseSync(join(directory, 'harbor.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, time TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, upload REAL NOT NULL, download REAL NOT NULL, mode TEXT NOT NULL);`);
    this.traffic = new TrafficStore(this.db); this.logs = new LogStore(this.db);
    if (!this.get('settings')) this.seed();
    if (this.get('settings').demandAware === undefined) this.set('settings',{...this.get('settings'),demandAware:true});
  }
  get(key, fallback = null) { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  set(key, value) { this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); return value; }
  seal(value) {
    if (!value) return '';
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  unseal(value) {
    if (!value) return '';
    const data = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
  password(value) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`; }
  verify(value) {
    const hash = this.get('admin'); if (!hash) return false;
    const [salt, expected] = hash.split(':');
    return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(expected, 'hex'));
  }
  event(title, detail = '', level = 'info', context = {}) {
    title=redact(title);detail=redact(detail);
    this.db.prepare('INSERT INTO events(time,level,title,detail) VALUES (?,?,?,?)').run(new Date().toISOString(), level, title, detail);
    this.db.prepare('DELETE FROM events WHERE id < (SELECT COALESCE(MAX(id),0)-2000 FROM events)').run();
    const scope=/连接|下载器/.test(title)?'connection':/限速|接管|恢复|调度/.test(title)?'control':/配置|规则|设置|标签/.test(title)?'config':'system';
    this.logs.write({level,scope,code:context.code||'event',message:title,context:{detail,...context}});
  }
  events() { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 150').all(); }
  sample(upload, download, mode) {
    this.db.prepare('INSERT INTO history(time,upload,download,mode) VALUES(?,?,?,?)').run(Date.now(), upload, download, mode);
    this.db.prepare('DELETE FROM history WHERE time < ?').run(Date.now() - 86400000 * 7);
  }
  history(mode) { return this.db.prepare('SELECT time,upload,download FROM history WHERE mode=? ORDER BY id DESC LIMIT 90').all(mode).reverse(); }
  seed() {
    const MiB = 1048576;
    this.set('settings', { mode: 'demo', controlEnabled: false, demandAware: true, uploadBudget: 60 * MiB, downloadBudget: 180 * MiB, pollSeconds: 5, controlSeconds: 15, timezone: 'Asia/Shanghai' });
    this.set('clients', [
      { id: 'demo-qb1', name: '主力下载器', type: 'qb', demo: true, enabled: true, url: '', username: '' },
      { id: 'demo-tr1', name: '保种仓库', type: 'tr', demo: true, enabled: true, url: '', username: '' },
      { id: 'demo-qb2', name: '影音专用', type: 'qb', demo: true, enabled: true, url: '', username: '' }
    ]);
    this.set('pools', [
      { id: 'pool-north', name: '北岸 · 日常下载', color: '#218575', upload: 24 * MiB, download: 80 * MiB, weight: 3 },
      { id: 'pool-orbit', name: '星轨 · 长期保种', color: '#6b75c6', upload: 12 * MiB, download: 40 * MiB, weight: 1 },
      { id: 'pool-forest', name: '林间 · 影音收藏', color: '#cc9153', upload: 18 * MiB, download: 60 * MiB, weight: 2 }
    ]);
    this.set('rules', [
      { id: 'rule-north', name: '北岸站点共享池', enabled: true, priority: 10, clients: [], hosts: ['north.example'], tags: [], states: [], poolId: 'pool-north', upload: null, download: null, weight: 1, schedule: null },
      { id: 'rule-orbit', name: '星轨站点共享池', enabled: true, priority: 20, clients: [], hosts: ['orbit.example'], tags: [], states: [], poolId: 'pool-orbit', upload: null, download: null, weight: 1, schedule: null },
      { id: 'rule-forest', name: '林间站点共享池', enabled: true, priority: 30, clients: [], hosts: ['forest.example'], tags: [], states: [], poolId: 'pool-forest', upload: null, download: null, weight: 1, schedule: null },
      { id: 'rule-seed', name: '保种标签 · 单种上传上限', enabled: true, priority: 40, clients: [], hosts: [], tags: ['保种'], states: [], poolId: '', upload: MiB, download: null, weight: 1, schedule: null }
    ]);
    this.set('labels', {}); this.set('overrides', {}); this.set('managed', {});
    this.event('欢迎来到种子港', '已加载独立演示环境。示例站点与数据均为模拟，不连接真实下载器。');
  }
  publicClients() { return this.get('clients', []).map(({ password, ...c }) => ({ ...c, hasPassword: Boolean(password) })); }
  close() { this.db.close(); }
}
