import { readFileSync } from 'node:fs';
export const siteIcons=JSON.parse(readFileSync(new URL('./site-icons.json',import.meta.url),'utf8'));
const ids=new Set(siteIcons.map(i=>i.id));
export function validateIcon(icon) { if(icon!==''&&icon!=='auto'&&!ids.has(icon))throw new Error('请选择列表中的站点图标');return icon; }

