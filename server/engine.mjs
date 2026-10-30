export const MiB = 1048576;
export const sameLimit = (a, b) => a == null ? b == null : b != null && Math.abs(a - b) < 1;
export function trackerHost(value) { try { return new URL(value).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; } }
export function hostMatches(host, pattern) {
  const p = pattern.toLowerCase().trim();
  return p.startsWith('*.') ? host === p.slice(2) || host.endsWith(`.${p.slice(2)}`) : host === p;
}
export function inSchedule(schedule, now, timezone) {
  if (!schedule) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  const cvt = t => Number(t.slice(0,2)) * 60 + Number(t.slice(3));
  const start = cvt(schedule.start), end = cvt(schedule.end);
  const anchorDay = start > end && minute < end ? (day + 6) % 7 : day;
  if (schedule.days?.length && !schedule.days.includes(anchorDay)) return false;
  return start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
}
export function matches(t, rule, now, timezone) {
  return t.metadataReady !== false && rule.enabled && inSchedule(rule.schedule, now, timezone)
    && (!rule.clients?.length || rule.clients.includes(t.clientId))
    && (!rule.hosts?.length || t.hosts.some(h => rule.hosts.some(p => hostMatches(h, p))))
    && (!rule.tags?.length || rule.tags.every(tag => t.tags.includes(tag)))
    && (!rule.states?.length || rule.states.includes(t.state))
    && (!rule.category || t.category === rule.category);
}
// Weighted max-min allocation. All finite results are floored to bytes/s; sum <= budget.
export function allocate(items, budget) {
  const result = new Map(items.map(i => [i.id, 0]));
  if (budget == null) { items.forEach(i => result.set(i.id, i.cap ?? null)); return result; }
  let remaining = Math.max(0, budget), open = items.filter(i => i.cap == null || i.cap > 0);
  while (open.length && remaining > 0) {
    const totalWeight = open.reduce((s, i) => s + Math.max(0.01, i.weight || 1), 0);
    const satisfied = open.filter(i => i.cap != null && i.cap <= remaining * Math.max(.01, i.weight || 1) / totalWeight);
    if (!satisfied.length) {
      open.forEach(i => result.set(i.id, Math.floor(remaining * Math.max(.01, i.weight || 1) / totalWeight)));
      break;
    }
    for (const i of satisfied) { result.set(i.id, Math.floor(i.cap)); remaining -= Math.floor(i.cap); }
    const ids = new Set(satisfied.map(i => i.id)); open = open.filter(i => !ids.has(i.id));
  }
  return result;
}
const minCap = caps => { const f = caps.filter(v => v != null); return f.length ? Math.min(...f) : null; };
export function buildPlan(torrents, rules, pools, settings, overrides = {}, now = new Date()) {
  const byKey = new Map(torrents.map(t=>[t.key,t]));
  const ordered = [...rules].sort((a,b) => a.priority-b.priority || a.id.localeCompare(b.id));
  const plan = torrents.map(t => {
    const matched = ordered.filter(r => matches(t, r, now, settings.timezone));
    const override = overrides[t.key]?.expires > now.getTime() ? overrides[t.key] : null;
    const pool = matched.map(r => pools.find(p => p.id === r.poolId)).find(Boolean);
    return { key: t.key, clientId: t.clientId, torrentId: t.id, name: t.name, poolId: pool?.id || '', poolName: pool?.name || '单种规则', matchedRules: matched.map(r => ({ id:r.id, name:r.name })), managed: Boolean(matched.length || override), weight: override?.weight || Math.max(1, ...matched.map(r => r.weight || 1)), uploadCap: minCap([ ...matched.map(r => r.upload), override?.upload ]), downloadCap: minCap([ ...matched.map(r => r.download), override?.download ]), upload: null, download: null, currentUpload: t.uploadLimit, currentDownload: t.downloadLimit, online: t.online, state: t.state, override, reasons: [] };
  });
  for (const dir of ['upload','download']) {
    const demandCaps = new Map(plan.map(p => {
      const t = byKey.get(p.key);
      if (!settings.demandAware || t[dir] == null) return [p.key,p[`${dir}Cap`]];
      const rate = Math.max(0,t[dir]), current = t[`${dir}Limit`];
      const idle = t.state === 'paused' || (dir === 'download' && t.progress >= 1);
      const probe = idle ? 16384:131072;
      // A saturated limiter is evidence of hidden demand; let it grow geometrically.
      const demand = Math.max(probe,rate*1.6,current != null && rate >= current*.75 ? current*1.5:0);
      return [p.key,minCap([p[`${dir}Cap`],Math.floor(demand)])];
    }));
    const groups = new Map();
    for (const p of plan.filter(p => p.managed)) {
      const id = p.poolId || `single:${p.key}`;
      if (!groups.has(id)) groups.set(id, []); groups.get(id).push(p);
    }
    const groupItems = [...groups].map(([id, entries]) => {
      const pool = pools.find(p => p.id === id);
      const total = entries.every(e => demandCaps.get(e.key) != null) ? entries.reduce((s,e) => s + demandCaps.get(e.key), 0) : null;
      return { id, weight: pool?.weight || 1, cap: minCap([pool?.[dir], total]) };
    });
    const budgets = allocate(groupItems, settings[`${dir}Budget`]);
    for (const [id, entries] of groups) {
      const result = allocate(entries.map(p => ({ id:p.key, weight: p.weight * (p.state === 'paused' ? .02 : p.state === 'stalled' ? .15 : dir === 'download' && p.state === 'seeding' ? .02 : 1), cap:demandCaps.get(p.key) })), budgets.get(id));
      entries.forEach(p => { p[dir] = result.get(p.key); });
    }
  }
  for (const p of plan) {
    if (p.poolId) p.reasons.push(`主带宽池：${p.poolName}（多个池命中时按规则优先级选择一个）`);
    if (p.uploadCap != null) p.reasons.push('上传同时受所有命中规则的单种上限约束');
    if (p.downloadCap != null) p.reasons.push('下载同时受所有命中规则的单种上限约束');
    if (p.override) p.reasons.push('临时设置有效，到期自动回到规则；临时设置不会放宽规则硬上限');
    if (p.managed && settings.demandAware) p.reasons.push('按实测需求回收闲置份额，保留探测额度；持续贴近上限的任务会逐步获得更多额度');
    if (!p.managed) p.reasons.push(byKey.get(p.key)?.metadataReady === false ? '完整 Tracker 元数据尚未就绪，暂不计算或接管，既有配额保留':'没有命中规则，保留原生设置，不计入受管带宽预算');
    if (p.managed && (p.upload === 0 || p.download === 0)) p.reasons.push('预算不足，不能写入零值冒充限速；本轮拒绝接管');
  }
  return plan;
}
