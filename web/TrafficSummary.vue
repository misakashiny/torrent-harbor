<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { ArrowDown, ArrowUp } from 'lucide-vue-next';
import { formatBytes } from './format.mjs';
const props=defineProps({api:Function,mode:String,timezone:String});
const options=[['1h','1 小时'],['12h','12 小时'],['24h','24 小时'],['3d','3 天'],['7d','7 天'],['all','全部']];
const range=ref('24h'),stats=ref(null),error=ref(''),loading=ref(false);let timer,sequence=0;
async function load(){const seq=++sequence;loading.value=true;try{const s=await props.api('traffic?range='+range.value);if(seq===sequence){stats.value=s;error.value='';}}catch(e){if(seq===sequence)error.value=e.message;}finally{if(seq===sequence)loading.value=false;}}
watch([range,()=>props.mode],()=>{stats.value=null;void load();});
onMounted(()=>{load();timer=setInterval(load,15000);});onUnmounted(()=>{sequence++;clearInterval(timer);});
const date=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:props.timezone||'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
const note=computed(()=>{
  const s=stats.value;if(!s)return '正在读取累计流量…';
  if(!s.clients.length)return '启用下载器后开始记录流量。';
  if(s.upload===null)return '尚未读到下载器的累计计数，等待下一次同步。';
  if(range.value==='all')return '下载器自身保存的历史累计，包含安装种子港之前的流量。'+(s.partial?' 部分下载器缺少计数或离线，当前合计不完整。':'');
  const begin=s.since?date(Math.max(s.start,s.since)):'等待同步';
  return `记录起点 ${begin} · 按计数差值累计，分钟边界按比例统计。`+(s.partial?' 当前时段尚未录满或存在同步中断，仅显示已记录流量。':'');
});
</script>
<template>
  <section class="panel traffic-summary" aria-label="累计传输流量" :aria-busy="loading">
    <div class="traffic-summary-head"><h2>累计传输</h2><div class="range-tabs" aria-label="累计流量时间范围"><button v-for="[id,label] in options" :key="id" :aria-pressed="range===id" :class="{active:range===id}" @click="range=id">{{label}}</button></div></div>
    <p v-if="error" class="error-message" role="alert">{{error}} <button class="text-button" @click="load">重试</button></p>
    <template v-else><div class="traffic-values"><div><span><ArrowDown :size="16"/>总下载</span><strong>{{formatBytes(stats?.download)}}</strong></div><div><span><ArrowUp :size="16"/>总上传</span><strong>{{formatBytes(stats?.upload)}}</strong></div></div><p class="traffic-note">{{note}}<span v-if="mode==='demo'"> 演示数据。</span></p>
    <details v-if="stats?.clients.length" class="traffic-breakdown"><summary>查看各下载器累计</summary><div v-for="c in stats.clients" :key="c.id"><span>{{c.name}}<small v-if="c.stale"> · 数据待同步</small></span><span>↓ {{formatBytes(c.download)}}<br>↑ {{formatBytes(c.upload)}}</span></div></details></template>
  </section>
</template>
