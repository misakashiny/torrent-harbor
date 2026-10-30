<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue';
import ConnectionSummary from './ConnectionSummary.vue';
import { ArrowDown, ArrowUp, ChevronRight, AlertTriangle } from 'lucide-vue-next';
import TrafficSummary from './TrafficSummary.vue';
import SiteIcon from './SiteIcon.vue';
import {poolStatus,poolRate} from './pool-status.mjs';
const props=defineProps({data:Object,rules:Array,api:Function,format:Function,time:Function});
const emit=defineEmits(['navigate','pool','detail']);
const minutes=ref(5);
const layoutQuery=window.matchMedia('(max-width: 1100px)');
const stacked=ref(layoutQuery.matches);
function layoutChanged(event) {
  const focused=document.activeElement?.closest('.overview-clients') ? document.activeElement.dataset.connectionAction : null;
  stacked.value=event.matches;
  if(focused)nextTick(()=>document.querySelector('.overview-clients [data-connection-action="'+focused+'"]')?.focus());
}
onMounted(()=>layoutQuery.addEventListener('change',layoutChanged));
onUnmounted(()=>layoutQuery.removeEventListener('change',layoutChanged));
const online=computed(()=>props.data.clients.filter(c=>c.online&&!c.stale).length);
const rate=dir=>props.data.clients.filter(c=>c.online&&!c.stale).reduce((n,c)=>n+(c[dir]||0),0);
const history=computed(()=>props.data.history.filter(h=>h.time>=props.data.now-minutes.value*60000));
const max=computed(()=>{const n=Math.max(1024,...history.value.flatMap(h=>[h.upload,h.download]));const pow=10**Math.floor(Math.log10(n));return Math.ceil(n/pow)*pow;});
function path(dir){const start=props.data.now-minutes.value*60000;let last=0;return history.value.map((h,i)=>{const x=(h.time-start)/(minutes.value*60000)*800,y=156-Math.min(h[dir]/max.value,1)*150;const p=`${i===0||h.time-last>30000?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`;last=h.time;return p;}).join(' ');}
const poolRows=computed(()=>[...props.data.pools].sort((a,b)=>{const r=props.data.poolStats;return (r[b.id]?.download+r[b.id]?.upload||0)-(r[a.id]?.download+r[a.id]?.upload||0);}).slice(0,5));
const age=computed(()=>{const ts=props.data.clients.filter(c=>c.online&&c.time).map(c=>c.time);return ts.length?props.time(Math.min(...ts)):'等待首次同步';});
</script>
<template>
  <div class="overview-layout">
    <div class="overview-primary">
    <section class="panel live-panel">
      <div class="live-status"><span><i class="dot" :class="online===data.clients.length&&online?'green-dot':'warning-dot'"></i>{{online}} / {{data.clients.length}} 下载器在线</span><span>同步 {{age}}</span></div>
      <button v-if="data.conflictCount||data.error||data.blocked||online<data.clients.length" class="overview-alert" @click="emit('navigate','activity')"><AlertTriangle :size="17"/><span>{{data.error||data.blocked||(data.conflictCount?`${data.conflictCount} 项限速待确认`:'有下载器未连接或同步已过期')}} · 查看记录</span><ChevronRight :size="16"/></button>
      <div class="live-rates"><div><span><ArrowDown :size="17"/>实时下载</span><strong>{{online?format(rate('download')):'—'}}</strong></div><div><span><ArrowUp :size="17"/>实时上传</span><strong>{{online?format(rate('upload')):'—'}}</strong></div></div>
      <div class="trend-heading"><div><span class="chart-key download-key"></span>下载 <span class="chart-key upload-key"></span>上传</div><select v-model.number="minutes" aria-label="实时速率图时间范围"><option :value="5">最近 5 分钟</option><option :value="15">最近 15 分钟</option></select></div>
      <div class="rate-chart" role="img" :aria-label="`最近 ${minutes} 分钟实际采样速率；${history.length} 个采样点`"><div class="chart-labels"><span>{{format(max)}}</span><span>{{format(max/2)}}</span><span>0</span></div><div class="chart-plot"><div class="chart-grid"><i></i><i></i><i></i></div><svg viewBox="0 0 800 160" preserveAspectRatio="none" aria-hidden="true"><path :d="path('upload')" class="upload-line"/><path :d="path('download')" class="download-line"/></svg><p v-if="history.length<2" class="chart-empty">等待连续采样</p></div></div>
      <div class="chart-times"><span>{{time(data.now-minutes*60000,true)}}</span><span>{{time(data.now,true)}}</span></div>
      <div class="live-counts"><span>共 {{data.total.toLocaleString()}} 个种子</span><button @click="emit('navigate','torrents')">{{data.active}} 个正在传输<ChevronRight :size="14"/></button></div>
    </section>
    <ConnectionSummary v-if="!stacked" :clients="data.clients" :format="format" :time="time" @navigate="emit('navigate',$event)"/>
    </div>
    <div class="overview-secondary">
    <TrafficSummary :api="api" :mode="data.settings.mode" :timezone="data.settings.timezone"/>
    <section class="panel flow-panel"><div class="panel-head"><h2>带宽去向</h2><button class="text-button" @click="emit('navigate','pools')">全部站点<ChevronRight :size="15"/></button></div><button v-for="p in poolRows" :key="p.id" class="flow-row" @click="emit('pool',p.id)"><SiteIcon :pool="p" :rules="rules" :size="28"/><span class="flow-name"><strong>{{p.name}}</strong><small>{{data.poolStats[p.id]?.count||0}} 个种子<span v-if="poolStatus(data.poolStats[p.id]).unknown||poolStatus(data.poolStats[p.id]).partial"> · {{poolStatus(data.poolStats[p.id]).note}}</span></small></span><span class="flow-rates"><span>↓ {{poolRate(data.poolStats[p.id],'download',format)}}</span><small>↑ {{poolRate(data.poolStats[p.id],'upload',format)}}</small></span><ChevronRight :size="15"/></button><p v-if="!poolRows.length" class="empty-message">尚未配置带宽池，请在电脑端添加。</p></section>
    </div>
    <ConnectionSummary v-if="stacked" :clients="data.clients" :format="format" :time="time" @navigate="emit('navigate',$event)"/>
    <section class="panel overview-tasks desktop-only"><div class="panel-head"><h2>正在传输</h2><button class="text-button" @click="emit('navigate','torrents')">全部种子<ChevronRight :size="15"/></button></div><button v-for="t in data.topTorrents" :key="t.key" class="top-task" @click="emit('detail',t)"><span><strong>{{t.name}}</strong><small>{{t.clientName}} · {{t.plan?.poolName||'未分组'}}</small></span><span>↓ {{format(t.download)}}<small>↑ {{format(t.upload)}}</small></span></button><p v-if="!data.topTorrents.length" class="empty-message">暂无可用的种子快照。</p></section>
  </div>
</template>
