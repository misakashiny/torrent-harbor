import icons from '../server/site-icons.json';
export { icons };
const normalize=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const aliases={mteam:['馒头','mtorrent'],hdsky:['天空'],chdbits:['彩虹岛'],ourbits:['我堡'],pterclub:['猫站','pter'],hdhome:['家园'],audiences:['观众'],hhanclub:['憨憨'],totheglory:['ttg'],hdchina:['瓷器'],springsunday:['春天','ssd'],panda:['熊猫'],hdfans:['红豆饭'],lemonhd:['柠檬'],pttime:['时间'],ptchdbits:['彩虹岛']};
export function poolIcon(pool,rules=[]) {
  if(pool?.icon==='')return null;
  if(pool?.icon&&pool.icon!=='auto')return icons.find(i=>i.id===pool.icon)||null;
  const hosts=rules.filter(r=>r.poolId===pool?.id).flatMap(r=>r.hosts||[]).map(h=>h.toLowerCase().split('.').map(normalize));
  const name=normalize(pool?.name);
  return icons.find(i=>{const key=normalize(i.name);if(key.length<3||key.startsWith('default'))return false;return hosts.some(parts=>parts.includes(key))||name===key||(name.length>key.length&&name.includes(key))||(aliases[key]||[]).some(a=>name.includes(normalize(a))||hosts.some(parts=>parts.includes(normalize(a))));})||null;
}
