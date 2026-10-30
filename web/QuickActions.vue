<script setup>
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Zap, Plus, X, Pencil, Trash2, Square, Eye, ChevronRight } from 'lucide-vue-next';
import SiteIcon from './SiteIcon.vue';
const props=defineProps({api:Function,data:Object,compactBar:Boolean,mobile:Boolean});
const emit=defineEmits(['changed','notify','manage']);
const state=ref({definitions:[],runs:[],revision:''}), busy=ref(false), error=ref(''), editor=ref(null), preview=ref(null), searching=ref({}), dialog=ref(null);
const pools=computed(()=>props.data.pools||[]), controlled=computed(()=>props.data.settings.controlEnabled);
const message=text=>emit('notify',text);
const rate=n=>n==null?'不限速':n>=1048576?`${+(n/1048576).toFixed(3)} MiB/s`:`${+(n/1024).toFixed(2)} KiB/s`;
const names=ids=>ids.map(id=>pools.value.find(p=>p.id===id)?.name||'已移除站点').join('、');
const effectText=e=>`${names(e.poolIds)} · ${e.kind==='unlimited'?'不限速':e.kind==='shared'?'每站共享':'每个种子'} · ${e.directions.map(d=>(d==='upload'?'上传':'下载')+' '+rate(e[d])).join(' / ')}`;
const until=r=>r.expires?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:props.data.settings.timezone}).format(r.expires)+' 恢复':'手动停止后恢复';
const runFor=id=>state.value.runs.find(r=>r.actionId===id);
async function load(){try{state.value=await props.api('quick-actions');error.value='';}catch(e){error.value=e.message;}}
watch(()=>[props.data.settings.mode,props.data.quickActions?.revision,JSON.stringify(props.data.quickActions?.runs)],load);
onMounted(load);
async function operate(fn){if(busy.value)return;busy.value=true;error.value='';try{await fn();emit('changed');}catch(e){await load();error.value=e.message;emit('notify',e.message,true);}finally{busy.value=false;}}
function run(action){operate(async()=>{state.value=await props.api('quick-actions/run','POST',{actionId:action.id,revision:state.value.revision});message(controlled.value?'效果已提交，下轮调度执行；回读结果见运行记录':'一键效果已加入预览；当前只读，不会写入下载器');preview.value=null;});}
function stop(id){operate(async()=>{state.value=await props.api('quick-actions/stop','POST',id?{runId:id}:{});message(controlled.value?'一键效果已停止，下轮调度按剩余效果和原规则执行':'已停止预览效果；当前只读，下载器设置未改动');});}
function remove(action){operate(async()=>{state.value=await props.api('quick-actions/'+action.id+'?revision='+state.value.revision,'DELETE');message('按钮已删除');});}
const newEffect=()=>({kind:'unlimited',poolIds:[],directions:['upload'],upload:1,download:1});
function edit(action){searching.value={};preview.value=null;editor.value=action?{...JSON.parse(JSON.stringify(action)),effects:action.effects.map(e=>({...JSON.parse(JSON.stringify(e)),upload:e.upload==null?1:e.upload/1048576,download:e.download==null?1:e.download/1048576}))}:{name:'',minutes:null,effects:[newEffect()]};}
function payload(){return {...editor.value,revision:state.value.revision,effects:editor.value.effects.map(e=>({...e,upload:e.kind==='unlimited'?null:Number(e.upload)*1048576,download:e.kind==='unlimited'?null:Number(e.download)*1048576}))};}
function save(){operate(async()=>{state.value=await props.api('quick-actions'+(editor.value.id?'/'+editor.value.id:''),editor.value.id?'PUT':'POST',payload());editor.value=null;message('一键按钮已保存，现有运行效果保持原样');});}
async function inspect(action){await operate(async()=>{preview.value=await props.api('quick-actions/preview','POST',action?{actionId:action.id,revision:state.value.revision}:payload());if(action)preview.value.action=action;});}
const filtered=i=>pools.value.filter(p=>p.name.toLowerCase().includes((searching.value[i]||'').toLowerCase()));
function select(i,kind){const e=editor.value.effects[i], shown=filtered(i).map(p=>p.id), selected=new Set(e.poolIds);for(const id of shown){if(kind==='all')selected.add(id);else if(selected.has(id))selected.delete(id);else selected.add(id);}e.poolIds=[...selected];preview.value=null;}
function direction(e,dir,checked){if(checked)e.directions=[...new Set([...e.directions,dir])];else e.directions=e.directions.filter(d=>d!==dir);}
watch(editor,()=>{if(editor.value)preview.value=null;},{deep:true});
let focusBefore, previousOverflow='';
const opened=computed(()=>!!editor.value||!!preview.value?.action);
watch(opened,async(value)=>{if(value){focusBefore=document.activeElement;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';await nextTick();dialog.value?.querySelector('input,button')?.focus();}else{document.body.style.overflow=previousOverflow;focusBefore?.focus();}});
function close(){if(busy.value)return;editor.value=null;preview.value=null;error.value='';}
function keys(e){if(!opened.value)return;if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){const nodes=[...dialog.value.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(n=>n.offsetParent!==null),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
onMounted(()=>document.addEventListener('keydown',keys));onUnmounted(()=>{document.removeEventListener('keydown',keys);if(opened.value)document.body.style.overflow=previousOverflow;});
</script>
<template>
  <div class="quick-actions" :class="{'quick-bar':compactBar,'quick-workspace':!compactBar}">
    <div class="quick-heading"><h2><Zap :size="16"/>{{compactBar?'一键操作':'操作预设'}} <small v-if="state.runs.length">{{state.runs.length}} 项{{controlled?'运行中':'预览中'}}</small></h2><button v-if="compactBar" class="text-button" @click="emit('manage')">管理<ChevronRight :size="14"/></button><button v-else-if="!mobile" class="btn primary" @click="edit()"><Plus :size="16"/>新建按钮</button></div>
    <p v-if="!controlled&&state.definitions.length" class="quick-note">只读预览：按钮不会写入下载器。电脑端开启自动接管后执行。</p>
    <div class="quick-workspace-body">
    <div class="quick-presets">
    <div v-if="state.definitions.length" class="quick-buttons">
      <article v-for="a in state.definitions" :key="a.id" :class="{running:runFor(a.id)}">
        <div class="quick-button-row"><button class="btn" :disabled="busy" :title="a.effects.map(effectText).join('\n')" @click="run(a)"><Zap :size="16"/>{{a.name}}</button><span v-if="runFor(a.id)" class="quick-state">{{controlled?'运行中':'预览中'}}</span><button v-if="runFor(a.id)" class="btn quick-stop" :disabled="busy" :aria-label="'停止 '+a.name" @click="stop(runFor(a.id).id)"><Square :size="13"/>停止</button></div>
        <template v-if="!compactBar"><p class="quick-timing">{{runFor(a.id)?until(runFor(a.id)):a.minutes?'执行 '+a.minutes+' 分钟后恢复':'手动停止后恢复'}}<span v-if="runFor(a.id)"> · 再次执行会重新计时</span></p><div class="quick-effect-table"><div class="quick-effect-head"><span>适用站点</span><span>限速方式</span><span>方向 / 上限</span></div><div v-for="(e,i) in a.effects" :key="i" class="quick-effect-line"><div><span class="quick-sites-inline" v-for="id in e.poolIds.slice(0,2)" :key="id">{{pools.find(p=>p.id===id)?.name||'已移除站点'}}</span><details v-if="e.poolIds.length>2"><summary>展开全部 {{e.poolIds.length}} 个站点</summary><p>{{names(e.poolIds)}}</p></details></div><span>{{e.kind==='unlimited'?'不限速':e.kind==='shared'?'每站共享':'每个种子'}}</span><span><small v-for="dir in e.directions" :key="dir">{{dir==='upload'?'↑ 上传':'↓ 下载'}} {{e.kind==='unlimited'?'不限速':rate(e[dir])}}</small></span></div></div><div class="quick-card-footer"><small>{{a.effects.length}} 项效果</small><div><button class="text-button" :disabled="busy" :aria-label="'预览 '+a.name" @click="inspect(a)"><Eye :size="16"/>详情</button><button v-if="!mobile" class="text-button" :disabled="busy" :aria-label="'编辑 '+a.name" @click="edit(a)"><Pencil :size="16"/>编辑</button><button v-if="!mobile" class="icon-button" :disabled="busy||!!runFor(a.id)" :aria-label="'删除 '+a.name" @click="remove(a)"><Trash2 :size="16"/></button></div></div></template>
      </article>
    </div>
    <p v-else class="quick-empty">还没有一键按钮。<button v-if="compactBar" class="text-button" @click="emit('manage')">去设置</button><span v-else>{{mobile?'请在电脑端创建站点操作。':'创建后即可从总览快速执行。'}}</span></p>
    </div>
    <aside v-if="!compactBar" class="quick-current"><h2>当前效果</h2><p v-if="!state.runs.length" class="quick-empty">当前没有运行的效果。执行左侧预设后，可在这里查看与停止。</p><div v-for="r in state.runs" :key="r.id" class="quick-current-run"><span class="quick-state">{{controlled?'效果运行中':'只读预览中'}}</span><h3>{{r.name}}</h3><p class="quick-timing">{{until(r)}}</p><dl><div v-for="(e,i) in r.effects" :key="i"><dt>{{e.poolIds.length}} 个站点 · {{e.kind==='unlimited'?'不限速':e.kind==='shared'?'每站共享':'每个种子'}}<details><summary>查看站点</summary><p>{{names(e.poolIds)}}</p></details></dt><dd><span v-for="dir in e.directions" :key="dir">{{dir==='upload'?'上传':'下载'}} {{e.kind==='unlimited'?'不限速':rate(e[dir])}}</span></dd></div></dl><button class="btn" :disabled="busy" :aria-label="'结束效果 '+r.name" @click="stop(r.id)"><Square :size="14"/>停止此效果</button></div><p v-if="state.runs.length" class="quick-note">执行时快照。编辑预设只影响下次执行，当前写入结果见任务进度与运行记录。</p><button v-if="state.runs.length" class="btn" :disabled="busy" @click="stop()"><Square :size="14"/>停止全部效果</button></aside>
    </div>
    <details v-if="!compactBar" class="quick-help"><summary>执行说明</summary><p>匹配当前及后续加入主池的成员，包含各下载器。同一站点同一方向，后执行的效果优先。停止后回到剩余效果与原规则；下载器自身的全局限速仍有效。</p></details>
    <p v-if="mobile&&!compactBar" class="quick-note">按钮创建、效果编辑与删除请使用电脑。</p>
    <p v-if="error&&!opened" class="form-error" role="alert">{{error}}</p>
    <Teleport to="body">
      <div v-if="opened" class="modal-backdrop quick-backdrop" @click.self="close"><section ref="dialog" class="modal quick-modal" role="dialog" aria-modal="true" :aria-labelledby="editor?'quick-editor-title':'quick-preview-title'">
        <div class="modal-head"><h2 :id="editor?'quick-editor-title':'quick-preview-title'">{{editor?(editor.id?'编辑一键按钮':'新建一键按钮'):'效果预览 · '+preview.action.name}}</h2><button class="icon-button" aria-label="关闭一键操作弹窗" :disabled="busy" @click="close"><X :size="20"/></button></div>
        <form v-if="editor" @submit.prevent="save" class="quick-editor">
          <div class="form-grid"><label>按钮名称<input v-model="editor.name" maxlength="40" required placeholder="例如：晚间保种限速"></label><label>恢复方式<select :value="editor.minutes===null?'manual':'timer'" @change="editor.minutes=$event.target.value==='manual'?null:30"><option value="manual">手动恢复</option><option value="timer">定时恢复</option></select></label><label v-if="editor.minutes!==null">持续分钟<input v-model.number="editor.minutes" type="number" min="1" max="10080" step="1" required></label></div>
          <p class="quick-note">选择主带宽池中的站点成员，规则仍决定归属；尚未命中该池的任务不会受影响。编辑仅影响下次执行，已启动的效果使用执行时的配置。</p>
          <fieldset v-for="(e,i) in editor.effects" :key="i" class="quick-effect"><legend>效果 {{i+1}}</legend><div class="quick-effect-top"><label>效果类型<select v-model="e.kind" :aria-label="'效果 '+(i+1)+' 类型'"><option value="unlimited">指定站点不限速</option><option value="per-torrent">每个种子限速</option><option value="shared">每个站点共享限速</option></select></label><div class="quick-directions"><label v-for="dir in ['upload','download']" :key="dir"><input type="checkbox" :checked="e.directions.includes(dir)" :aria-label="'效果 '+(i+1)+(dir==='upload'?' 上传':' 下载')" @change="direction(e,dir,$event.target.checked)">{{dir==='upload'?'上传':'下载'}}</label></div><button v-if="editor.effects.length>1" type="button" class="text-button" :aria-label="'移除效果 '+(i+1)" @click="editor.effects.splice(i,1)">移除</button></div>
            <div v-if="e.kind!=='unlimited'" class="form-grid"><label v-for="dir in e.directions" :key="dir">{{dir==='upload'?'上传':'下载'}}上限（MiB/s）<input v-model.number="e[dir]" type="number" min="0.000977" max="1073741824" step="any" required :aria-label="'效果 '+(i+1)+(dir==='upload'?' 上传':' 下载')+'上限 MiB/s'"></label></div>
            <p class="quick-note">{{e.kind==='unlimited'?'解除本程序所选方向的规则、池与总预算限制；下载器自身的总限速仍生效。':e.kind==='shared'?'每个选中站点各享一个共享上限，跨下载器分配；仍受本程序总预算约束。':'每个匹配种子各有此上限，替代该方向原规则及池上限；仍受本程序总预算约束。'}}</p>
            <div class="quick-selection-tools"><input v-model="searching[i]" placeholder="搜索站点" :aria-label="'效果 '+(i+1)+' 搜索站点'"><span>已选 {{e.poolIds.length}} / {{pools.length}}</span><button type="button" class="text-button" @click="select(i,'all')">全选筛选结果</button><button type="button" class="text-button" @click="select(i,'invert')">反选筛选结果</button><button type="button" class="text-button" @click="e.poolIds=[]">清空已选</button></div>
            <div class="quick-site-list"><label v-for="p in filtered(i)" :key="p.id"><input v-model="e.poolIds" type="checkbox" :value="p.id" :aria-label="'效果 '+(i+1)+' 选择 '+p.name"><SiteIcon :pool="p" :rules="data.rules" :size="22"/><span>{{p.name}}</span><small>{{data.poolStats?.[p.id]?.count||0}} 种</small></label><p v-if="!filtered(i).length">没有匹配站点。修改搜索后重试。</p></div>
          </fieldset>
          <button v-if="editor.effects.length<8" type="button" class="btn" @click="editor.effects.push(newEffect())"><Plus :size="15"/>添加效果</button>
          <div v-if="preview" class="quick-preview"><strong>当前快照预览</strong><p>匹配 {{preview.targets}} 个种子 / {{preview.clients}} 个下载器，其中 {{preview.offline}} 个种子离线；计划变化 {{preview.changed}} 个种子（含总预算重分配）。</p><p v-for="p in preview.problems" :key="p" class="form-error">{{p}}</p></div>
          <p v-if="error" class="form-error" role="alert">{{error}}</p><div class="modal-foot"><button type="button" class="btn" :disabled="busy" @click="inspect()">预览匹配</button><button class="btn primary" :disabled="busy">{{busy?'正在处理…':'保存按钮'}}</button></div>
        </form>
        <div v-else class="quick-preview-body"><p v-for="(e,i) in preview.action.effects" :key="i">{{effectText(e)}}</p><p>当前匹配 {{preview.targets}} 个种子 / {{preview.clients}} 个下载器，其中 {{preview.offline}} 个种子离线。计划变化 {{preview.changed}} 个种子（含总预算重分配）。</p><p v-for="p in preview.problems" :key="p" class="form-error">{{p}}</p><div class="quick-samples"><div v-for="s in preview.samples" :key="s.key"><span>{{s.name}}<small>{{s.poolName}}{{s.online?'':' · 离线'}}</small></span><span>↑ {{rate(s.upload)}}<small>↓ {{rate(s.download)}}</small></span></div></div><p class="quick-note">仅展示前 12 个匹配任务。预览不写入下载器；实际分配随成员、其他效果与总预算变化。</p><p v-if="error" class="form-error" role="alert">{{error}}</p><div class="modal-foot"><button class="btn" @click="close">关闭</button><button class="btn primary" :disabled="busy||!!preview.problems.length" @click="run(preview.action)">{{controlled?'执行此按钮':'启用只读预览'}}</button></div></div>
      </section></div>
    </Teleport>
  </div>
</template>
