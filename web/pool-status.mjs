// A known zero and an unavailable snapshot must remain distinguishable.
export function poolStatus(stats) {
  if(!stats||!Number.isFinite(stats.count)||!Number.isFinite(stats.offline))return {unknown:true,partial:false,note:'等待带宽池数据'};
  if(stats.count===0)return {unknown:false,partial:false,note:'暂无成员'};
  if(stats.offline>=stats.count)return {unknown:true,partial:false,note:`全部 ${stats.count} 个成员待同步`};
  if(stats.offline>0)return {unknown:false,partial:true,note:`${stats.offline} 个成员待同步 · 仅统计在线成员速率`};
  return {unknown:false,partial:false,note:'成员数据已同步'};
}
export function poolRate(stats,direction,format) {
  return poolStatus(stats).unknown||!Number.isFinite(stats?.[direction])?'—':format(stats[direction]);
}
