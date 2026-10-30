<script setup>
import {computed,ref} from 'vue';
import {Activity,CheckCircle2,AlertTriangle,ChevronRight,X} from 'lucide-vue-next';
const props=defineProps({job:Object,now:Number});const emit=defineEmits(['inspect']);const dismissed=ref('');
const running=computed(()=>props.job?.status==='running');
const visible=computed(()=>props.job&&props.job.id!==dismissed.value&&(running.value||props.now-(props.job.ended||props.job.updated)<86400000));
const percent=computed(()=>Math.min(100,Math.floor((props.job.processed||0)/Math.max(1,props.job.total)*100)));
const elapsed=computed(()=>Math.max(0,((running.value?props.now:props.job.ended||props.job.updated)-props.job.started)/1000));
const duration=n=>n<60?`${Math.floor(n)} 秒`:`${Math.floor(n/60)} 分 ${Math.floor(n%60)} 秒`;
const eta=computed(()=>{const j=props.job;return running.value&&j.processed>=100&&elapsed.value>=3?duration(elapsed.value/j.processed*(j.total-j.processed)):'';});
const title=computed(()=>props.job.kind==='release'?'恢复接管前设置':'批量调整限速');
const phase=computed(()=>({preparing:'核对当前限速',writing:'写入下载器',confirming:'回读确认',finished:props.job.status==='completed'?'全部处理完成':'已处理，部分需核对',interrupted:'任务已中断，请核对未确认项'})[props.job.phase]||'正在处理');
</script>
<template>
  <section v-if="visible" class="control-progress panel" :class="{attention:job.status==='attention'||job.status==='interrupted'}" aria-label="限速任务进度">
    <div class="control-progress-head"><component :is="running?Activity:job.status==='completed'?CheckCircle2:AlertTriangle" :size="19"/><strong>{{title}}</strong><span>{{phase}}</span><button v-if="!running" class="icon-button" aria-label="收起已完成的任务进度" @click="dismissed=job.id"><X :size="17"/></button></div>
    <div class="control-progress-numbers"><b>{{job.processed.toLocaleString()}} <small>/ {{job.total.toLocaleString()}} 项</small></b><span>{{percent}}%</span></div>
    <div class="control-progress-track" role="progressbar" :aria-valuenow="job.processed" :aria-valuemin="0" :aria-valuemax="job.total" :aria-valuetext="`${job.processed} / ${job.total} 项，${phase}`"><span :style="{width:percent+'%'}"></span></div>
    <div class="control-progress-meta"><span>已确认 {{(job.confirmed+job.unchanged).toLocaleString()}}<template v-if="job.unchanged">（{{job.unchanged.toLocaleString()}} 项无需写入）</template></span><span>失败 {{job.failed}} · 外部修改 {{job.conflict}} · 暂缓 {{job.blocked}}</span><span>剩余 {{Math.max(0,job.total-job.processed).toLocaleString()}}</span><span>{{job.torrents.toLocaleString()}} 个种子 · 上传、下载分别计项</span></div>
    <div class="control-progress-foot"><span>{{running&&job.clientName?job.clientName+' · ':''}}耗时 {{duration(elapsed)}}<template v-if="eta"> · 预计剩余 {{eta}}</template></span><button class="text-button" @click="emit('inspect')">查看记录<ChevronRight :size="14"/></button></div>
  </section>
</template>
