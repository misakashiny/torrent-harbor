export function limitNotice(status={}) {
  const progress=[['preparing','准备写入'],['writing','正在写入'],['confirming','等待回读确认']].filter(([key])=>status[key]>0).map(([key,label])=>`${label} ${status[key]} 项`).join(' · ');
  const issues=[['conflict','外部修改'],['failed','写入或回读失败'],['unconfirmed','上次写入未确认'],['review','历史记录待核对']].filter(([key])=>status[key]>0).map(([key,label])=>`${label} ${status[key]} 项`).join(' · ');
  return {progress,issues};
}
