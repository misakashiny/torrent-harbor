import { createHash } from 'node:crypto';
export const ruleRevision=rules=>createHash('sha256').update(JSON.stringify(rules)).digest('hex');
export const sortedRules=rules=>[...rules].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
export function reorderRules(rules,{ids,revision}) {
  if(revision!==ruleRevision(rules)){const e=new Error('规则已在其他页面修改，请刷新后重新排序');e.status=409;throw e;}
  if(!Array.isArray(ids)||ids.length!==rules.length||new Set(ids).size!==ids.length||ids.some(id=>!rules.some(r=>r.id===id)))throw new Error('排序必须包含全部规则且不能重复');
  const byId=new Map(rules.map(r=>[r.id,r]));return ids.map((id,priority)=>({...byId.get(id),priority}));
}
