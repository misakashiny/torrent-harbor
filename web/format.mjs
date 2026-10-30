export function formatBytes(value) {
  if(value===null||value===undefined||!Number.isFinite(value))return '—';
  const units=['B','KiB','MiB','GiB','TiB','PiB'],i=value>0?Math.min(5,Math.floor(Math.log(value)/Math.log(1024))):0;
  return `${(value/1024**i).toLocaleString('zh-CN',{maximumFractionDigits:i?2:0})} ${units[i]}`;
}
export const pageSizes=[25,50,100,200,300];
export const validPageSize=value=>pageSizes.includes(Number(value))?Number(value):25;
