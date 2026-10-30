const labels={preparing:'准备写入',writing:'正在写入',confirming:'等待回读确认',conflict:'外部修改',failed:'写入或回读失败',unconfirmed:'上次写入未确认',review:'历史记录待核对',confirmed:'已回读确认'};
export const limitKey=r=>`${r.mode}|${r.key}|${r.direction}`;
export function limitState(record,operation,result) {
  let state='confirmed',message='';
  if(record?.issue==='external')state='conflict';
  else if(record?.issue==='failed')state='failed';
  else if(record?.conflict||Object.hasOwn(record||{},'pending'))state=Object.hasOwn(record||{},'pending')?'unconfirmed':'review';
  if(result){state=result.state;message=result.message||'';}
  // Only a live operation in this process proves that pending is normal activity.
  // A persisted intent without it may have survived a crash and remains an issue.
  if(operation&&!record?.conflict&&!record?.issue){state=operation.phase;message='';}
  return {state,label:labels[state]||labels.review,message:message||record?.issueMessage||'',since:operation?.since||result?.time||record?.issueTime||record?.time||null};
}
export function limitStatuses(records,operations=new Map(),results=new Map(),mode) {
  const byKey=new Map(records.map(r=>[limitKey(r),limitState(r,operations.get(limitKey(r)),results.get(limitKey(r)))]));
  for(const [key,result] of results)if(key.startsWith(mode+'|')&&!byKey.has(key))byKey.set(key,limitState(null,operations.get(key),result));
  for(const [key,operation] of operations)if(key.startsWith(mode+'|')&&!byKey.has(key))byKey.set(key,limitState(null,operation));
  const counts={preparing:0,writing:0,confirming:0,conflict:0,failed:0,unconfirmed:0,review:0,confirmed:0,attention:0};
  for(const status of byKey.values())counts[status.state]++;
  counts.attention=counts.conflict+counts.failed+counts.unconfirmed+counts.review;
  return {byKey,counts};
}
