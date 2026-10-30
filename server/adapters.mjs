import { trackerHost } from './engine.mjs';

export const toSnake = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replaceAll('-', '_').toLowerCase();
const pick = (o, key, fallback = null) => o[key] ?? o[toSnake(key)] ?? fallback;
const cap = value => Number(value) > 0 ? Number(value) : null;
const request = async (url, options = {}) => {
  try { return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('无法连接下载器，请检查地址、网络与证书'); }
};
export function validateUrl(value) {
  let u; try { u = new URL(value); } catch { throw new Error('下载器地址格式不正确'); }
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('请使用不含账号、查询参数的 HTTP/HTTPS 地址');
  return u.href.replace(/\/$/, '');
}
export class QbAdapter {
  constructor(client, password) { this.client = client; this.password = password; this.base = validateUrl(client.url); this.cookie = ''; this.trackerCache = new Map(); }
  async login() {
    const r = await request(`${this.base}/api/v2/auth/login`, { method: 'POST', headers: { 'content-type':'application/x-www-form-urlencoded', Referer: `${this.base}/` }, body: new URLSearchParams({ username:this.client.username || '', password:this.password }) });
    if (!r.ok || (await r.text()).trim() !== 'Ok.') throw new Error('QB 登录失败，请检查账号、密码及 WebUI 访问设置');
    this.cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  }
  async call(path, data, retry = true) {
    if (!this.cookie) await this.login();
    const r = await request(`${this.base}/api/v2/${path}`, { method:data ? 'POST':'GET', headers: { Cookie:this.cookie, Referer:`${this.base}/`, ...(data ? { 'content-type':'application/x-www-form-urlencoded' } : {}) }, ...(data ? { body:new URLSearchParams(data) } : {}) });
    if ((r.status === 403 || r.status === 401) && retry) { this.cookie = ''; return this.call(path, data, false); }
    if (!r.ok) throw new Error(`QB 接口请求失败（HTTP ${r.status}）`);
    const text = await r.text(); try { return JSON.parse(text); } catch { return text; }
  }
  async snapshot() {
    const [rows, transfer, version, alternative] = await Promise.all([this.call('torrents/info'), this.call('transfer/info'), this.call('app/version'), this.call('transfer/speedLimitsMode')]);
    let traffic=null;
    try {
      const sync=await this.call(`sync/maindata?rid=${this.syncRid||0}`);
      this.syncRid=sync.rid||0;this.serverState={...(sync.full_update?{}:this.serverState),...sync.server_state};
      const {alltime_ul,alltime_dl}=this.serverState;
      if(Number.isFinite(alltime_ul)&&Number.isFinite(alltime_dl))traffic={upload:alltime_ul,download:alltime_dl,lifetime:true,source:'qb-alltime'};
    } catch { /* Counters are optional; losing statistics must not mark a working client offline. */ }
    if(!traffic&&Number.isFinite(transfer.up_info_data)&&Number.isFinite(transfer.dl_info_data))traffic={upload:transfer.up_info_data,download:transfer.dl_info_data,lifetime:false,source:'qb-session'};
    if (!Array.isArray(rows)) throw new Error('QB 返回的种子列表格式异常');
    // Refresh in bounded batches. New torrents are not controlled before full tracker metadata is ready.
    const pending = rows.filter(t => !this.trackerCache.has(t.hash) || Date.now()-this.trackerCache.get(t.hash).time > 300000).slice(0,24);
    for (let i = 0; i < pending.length; i += 6) await Promise.all(pending.slice(i,i+6).map(async t => {
      try {
        const trackers = await this.call(`torrents/trackers?hash=${encodeURIComponent(t.hash)}`);
        this.trackerCache.set(t.hash, { time:Date.now(), hosts:[...new Set(trackers.map(t => trackerHost(t.url)).filter(Boolean))] });
      } catch { /* Retain metadata; a new torrent remains read-only until the next successful refresh. */ }
    }));
    const current = new Set(rows.map(t => t.hash)); for (const hash of this.trackerCache.keys()) if (!current.has(hash)) this.trackerCache.delete(hash);
    return { version:String(version), traffic, upload:transfer.up_info_speed || 0, download:transfer.dl_info_speed || 0,
      native: { upload:cap(transfer.up_rate_limit), download:cap(transfer.dl_rate_limit), alternative:Boolean(Number(alternative)), note:'原生全局、替代限速、协议与局域网设置仍会影响实测速度' },
      torrents: rows.map(t => ({ id:t.hash, hash:t.hash, name:t.name, progress:t.progress, size:t.size, uploaded:t.uploaded || 0, downloaded:t.downloaded || 0, ratio:t.ratio || 0, upload:t.upspeed || 0, download:t.dlspeed || 0, uploadLimit:cap(t.up_limit), downloadLimit:cap(t.dl_limit), tags:(t.tags || '').split(',').map(x => x.trim()).filter(Boolean), category:t.category || '', hosts:this.trackerCache.get(t.hash)?.hosts || [], metadataReady:this.trackerCache.has(t.hash), state:/paused|stopped/i.test(t.state) ? 'paused' : /stalled/i.test(t.state) ? 'stalled' : /error|missing/i.test(t.state) ? 'error' : t.progress >= 1 ? 'seeding':'downloading', nativeState:t.state })) };
  }
  quantize(value) { return value == null ? null : Math.floor(value); }
  async readLimitState(id, direction) { return { value:await this.readLimit(id,direction) }; }
  async restoreLimitState(id, direction, state) { await this.setLimit(id,direction,state.value); }
  async setLimit(id, direction, value) { await this.call(`torrents/set${direction === 'upload' ? 'Upload':'Download'}Limit`, { hashes:id, limit:String(value ?? 0) }); }
  async readLimit(id, direction) {
    const result = await this.call(`torrents/${direction === 'upload' ? 'uploadLimit':'downloadLimit'}?hashes=${encodeURIComponent(id)}`);
    if (!(id in result)) throw new Error('QB 未返回限速确认值'); return cap(result[id]);
  }
}
export class TrAdapter {
  constructor(client, password) {
    this.client = client; this.password = password;
    const base = validateUrl(client.url);
    this.base = base.endsWith('/rpc') ? base : `${base}${base.endsWith('/transmission') ? '' : '/transmission'}/rpc`;
    this.session = ''; this.modern = false; this.unit = 1000;
  }
  async rpc(method, args = {}, retry = true) {
    const modern = this.modern;
    const values = modern ? Object.fromEntries(Object.entries(args).map(([k,v]) => [toSnake(k), k === 'fields' ? v.map(toSnake):v])) : args;
    const r = await request(this.base, { method:'POST', headers: { 'Content-Type':'application/json', 'X-Transmission-Session-Id':this.session, ...(this.client.username || this.password ? { Authorization:`Basic ${Buffer.from(`${this.client.username || ''}:${this.password}`).toString('base64')}` } : {}) }, body:JSON.stringify(modern ? { jsonrpc:'2.0', id:1, method:toSnake(method), params:values } : { method, arguments:values, tag:1 }) });
    if (r.status === 409 && retry) { this.session = r.headers.get('x-transmission-session-id') || ''; return this.rpc(method,args,false); }
    if (r.status === 401) throw new Error('TR 登录失败，请检查 RPC 用户名和密码');
    if (!r.ok) throw new Error(`TR 接口请求失败（HTTP ${r.status}）`);
    let body; try { body = await r.json(); } catch { throw new Error('TR 返回了非 JSON 响应，请检查 RPC 地址'); }
    if (modern ? Boolean(body.error) : body.result !== 'success') throw new Error('TR 拒绝了 RPC 请求，请检查版本与接口权限');
    return modern ? body.result : body.arguments;
  }
  async snapshot() {
    const session = await this.rpc('session-get');
    const version = String(session.version || '');
    this.legacySpeedLimits=/^(?:[1-3]\.|4\.0\.)/.test(version);
    if (/^4\.(?:[1-9]|\d{2,})\./.test(version) || /^[5-9]\./.test(version)) this.modern = true;
    const units = pick(session,'units',{}); this.unit = Number(pick(units,'speed-bytes',1000)) || 1000;
    const [response, stats] = await Promise.all([this.rpc('torrent-get',{ fields:['id','hashString','name','percentDone','totalSize','uploadedEver','downloadedEver','uploadRatio','rateUpload','rateDownload','uploadLimit','uploadLimited','downloadLimit','downloadLimited','labels','trackers','status','error','honorsSessionLimits',...(/^3\./.test(version)?[]:['group'])] }), this.rpc('session-stats')]);
    const rows = response.torrents;
    if (!Array.isArray(rows)) throw new Error('TR 返回的种子列表格式异常');
    const alt = Boolean(pick(session,'alt-speed-enabled',false));
    const cumulative=pick(stats,'cumulative-stats',{}), uploaded=pick(cumulative,'uploadedBytes'), downloaded=pick(cumulative,'downloadedBytes');
    const traffic=Number.isFinite(uploaded)&&Number.isFinite(downloaded)?{upload:uploaded,download:downloaded,lifetime:true,source:'tr-cumulative'}:null;
    return { version, traffic, upload:pick(stats,'uploadSpeed',0), download:pick(stats,'downloadSpeed',0),
      native: { upload:alt ? cap(pick(session,'alt-speed-up',0)*this.unit) : pick(session,'speed-limit-up-enabled',false) ? cap(pick(session,'speed-limit-up',0)*this.unit):null, download:alt ? cap(pick(session,'alt-speed-down',0)*this.unit) : pick(session,'speed-limit-down-enabled',false) ? cap(pick(session,'speed-limit-down',0)*this.unit):null, alternative:alt, minimumLimit:this.legacySpeedLimits?32768:this.unit, note:this.legacySpeedLimits?'旧版 TR 小额限速存在块粒度问题，按 32 KiB/s 向下保守分配；低于该值拒绝执行。原生全局与既有分组仍生效':'原生全局与既有带宽分组仍生效；本程序使用统一单种配额协调' },
      torrents:rows.map(t => ({ id:pick(t,'hashString') || pick(t,'id'), hash:pick(t,'hashString'), name:t.name, progress:pick(t,'percentDone',0), size:pick(t,'totalSize',0), uploaded:pick(t,'uploadedEver',0), downloaded:pick(t,'downloadedEver',0), ratio:pick(t,'uploadRatio',0), upload:pick(t,'rateUpload',0), download:pick(t,'rateDownload',0), uploadLimit:pick(t,'uploadLimited',false) ? Number(pick(t,'uploadLimit',0))*this.unit:null, downloadLimit:pick(t,'downloadLimited',false) ? Number(pick(t,'downloadLimit',0))*this.unit:null, tags:pick(t,'labels',[]), category:'', hosts:[...new Set((t.trackers || []).map(x => trackerHost(x.announce)).filter(Boolean))], metadataReady:true, state:t.error ? 'error' : t.status === 0 ? 'paused' : [1,2].includes(t.status) ? 'checking' : [3,4].includes(t.status) ? 'downloading' : 'seeding', nativeState:t.status, nativeGroup:t.group || '', honorsSessionLimits:pick(t,'honorsSessionLimits',true) })) };
  }
  // TR <=4.0 accounts in 16 KiB blocks. Live 4.0.5 transfers reached ~32 KiB/s
  // despite a 16 kB/s readback. Reserve full 32 KiB quanta, write 32 decimal kB.
  // Upstream: https://github.com/transmission/transmission/pull/7339
  quantize(value) { return value == null ? null : this.legacySpeedLimits?Math.floor(value/32768)*32*this.unit:Math.floor(value/this.unit)*this.unit; }
  limitProblem(value) { return this.legacySpeedLimits&&value!=null&&value<32768?'旧版 TR 单种份额低于 32 KiB/s，无法可靠执行；请增加预算、减少成员或升级 TR 至 4.1 及以上':''; }
  async readLimitState(id, direction) {
    const result=await this.rpc('torrent-get',{ids:[id],fields:[`${direction}Limited`,`${direction}Limit`]});
    if(result.torrents?.length!==1) throw new Error('TR 未返回原始限速状态');
    const t=result.torrents[0];
    return { enabled:Boolean(pick(t,`${direction}Limited`,false)), amount:Number(pick(t,`${direction}Limit`,0)), value:pick(t,`${direction}Limited`,false)?Number(pick(t,`${direction}Limit`,0))*this.unit:null };
  }
  async restoreLimitState(id, direction, state) {
    if(typeof state.enabled!=='boolean'||!Number.isFinite(state.amount)||state.amount<0) throw new Error('TR 原始限速状态无效');
    await this.rpc('torrent-set',{ids:[id],[`${direction}Limited`]:state.enabled,[`${direction}Limit`]:state.amount});
  }
  async setLimit(id, direction, value) { await this.rpc('torrent-set',{ ids:[id], [`${direction}Limited`]:value != null, ...(value == null ? {} : { [`${direction}Limit`]:Math.floor(value/this.unit) }) }); }
  async readLimit(id, direction) {
    const result = await this.rpc('torrent-get',{ ids:[id], fields:[`${direction}Limited`,`${direction}Limit`] });
    if (result.torrents?.length !== 1) throw new Error('TR 未返回限速确认值');
    const t = result.torrents[0]; return pick(t,`${direction}Limited`,false) ? Number(pick(t,`${direction}Limit`,0))*this.unit:null;
  }
}
export const createAdapter = (client, password) => client.type === 'qb' ? new QbAdapter(client,password) : new TrAdapter(client,password);
