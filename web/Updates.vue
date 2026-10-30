<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Download, RefreshCw, CheckCircle2, AlertTriangle, Github, RotateCcw, ShieldCheck, ArrowUpRight } from 'lucide-vue-next';
const props=defineProps({api:Function,notify:Function,controlled:Boolean,managed:Number});
const state=ref(null), repository=ref(''), autoCheck=ref(false), busy=ref(false), confirmation=ref(null), error=ref('');
let timer;
const active=computed(()=>['queued','downloading','verifying','backing-up','installing','checking','rolling-back'].includes(state.value?.job?.state));
const ready=computed(()=>state.value?.canInstall&&!props.controlled&&!props.managed&&!active.value);
const jobNames={queued:'等待执行',downloading:'下载安装包',verifying:'校验安装包', 'backing-up':'备份数据',installing:'切换版本',checking:'健康检查','rolling-back':'恢复原版本',succeeded:'操作完成',failed:'操作失败','recovery-needed':'需要处理'};
async function load(initial=false){try{state.value=await props.api('updates');if(initial){repository.value=state.value.repository;autoCheck.value=state.value.autoCheck;}}catch(e){error.value=e.message;}}
async function run(task){busy.value=true;error.value='';try{await task();}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function check(){await run(async()=>{state.value=await props.api('updates/check','POST',{});if(!state.value.error)props.notify(state.value.available?'发现新版本':'已检查正式发布版本');});}
async function save(){await run(async()=>{state.value=await props.api('updates/config','PUT',{repository:repository.value,autoCheck:autoCheck.value});props.notify('更新来源已保存');});}
async function plan(action){await run(async()=>{confirmation.value=await props.api('updates/plan','POST',{action});});}
async function apply(){await run(async()=>{const result=await props.api('updates/apply','POST',{planId:confirmation.value.id});state.value.job={id:result.jobId,state:'queued',message:'已提交主机执行器'};confirmation.value=null;props.notify('版本操作已提交，应用重启后可能需要重新登录');});}
onMounted(async()=>{await load(true);timer=setInterval(()=>load(),4000);});onUnmounted(()=>clearInterval(timer));
</script>

<template>
  <div v-if="!state" class="empty-card">正在读取版本信息…</div>
  <div v-else class="updates-layout">
    <section class="panel update-hero">
      <div class="update-emblem"><Download :size="30"/></div>
      <div class="update-heading"><span class="eyebrow">KEEP YOUR HARBOR CURRENT</span><h2>让种子港保持更新</h2><p>从 GitHub 正式版本获取安装包，校验后备份数据，再切换版本。</p></div>
      <button class="btn primary" @click="check" :disabled="busy||active"><RefreshCw :size="16" :class="{spin:busy}"/>检查更新</button>
      <div class="version-grid"><div><span>当前版本</span><strong>v{{state.version}}</strong><small>{{state.platform}}</small></div><div><span>最新正式版本</span><strong>{{state.latest?.tag||'等待检查'}}</strong><small>{{state.latest?(state.available?'有新版本可用':'已是当前正式版本或更新'):'点击检查获取发布信息'}}</small></div><div><span>主机更新执行器</span><strong class="agent-label"><i class="dot" :class="state.canInstall?'green-dot':'amber-dot'"></i>{{state.canInstall?'已连接':state.agentConnected?'来源不一致':'未连接'}}</strong><small>更新时仅重启种子港</small></div></div>
    </section>
    <div v-if="props.controlled||props.managed" class="warning-banner"><AlertTriangle :size="18"/><span>更新前请到“设置与备份”释放接管，待下载器限速恢复后继续。</span></div>
    <div v-if="state.error||error" class="warning-banner" role="alert"><AlertTriangle :size="18"/>{{error||state.error}}</div>
    <section v-if="state.job" class="panel update-job" aria-live="polite"><RefreshCw v-if="active" :size="22" class="spin"/><CheckCircle2 v-else-if="state.job.state==='succeeded'" :size="22"/><AlertTriangle v-else :size="22"/><div><strong>{{jobNames[state.job.state]||state.job.state}} · {{state.job.tag}}</strong><p>{{state.job.message}}</p><small v-if="active">应用重启时连接会短暂中断，重新登录后可查看结果。</small></div></section>
    <div class="settings-grid">
      <section class="panel settings-panel"><div class="panel-head"><div><h2><Github :size="19"/>更新来源</h2><p>公开仓库无需配置访问令牌</p></div></div><form class="update-source" @submit.prevent="save"><label>GitHub 仓库<input v-model="repository" required placeholder="owner/repository" :disabled="busy||active"></label><label class="check-label"><input v-model="autoCheck" type="checkbox" :disabled="busy||active">每 6 小时检查一次新版本</label><p class="field-note">自动检查只获取版本信息。安装需要先查看版本并确认。主机执行器固定信任 {{state.agent?.repository||'部署时指定的仓库'}}，更换来源需要同步修改主机配置。</p><button class="btn" :disabled="busy||active">保存来源</button><a class="text-button" :href="'https://github.com/'+state.repository" target="_blank" rel="noopener noreferrer">打开公开仓库<ArrowUpRight :size="15"/></a></form></section>
      <section class="panel settings-panel"><div class="panel-head"><div><h2><ShieldCheck :size="19"/>安装与恢复</h2><p>数据备份与健康检查由主机执行器完成</p></div></div><div class="setting-row"><div><strong>安装新版本</strong><p>{{state.latest&&!state.latest.assetReady?'当前架构的镜像安装包尚未就绪':state.available?'已发现适用版本，可预览安装':'检查后如有新版本，可在此安装'}}</p></div><button class="btn primary" :disabled="busy||!ready||!state.available||!state.latest?.assetReady" @click="plan('update')">预览更新</button></div><div class="setting-row"><div><strong>回退上一个版本</strong><p>{{state.agent?.previousVersion?'可恢复至 v'+state.agent.previousVersion+' 及其数据快照':'首次成功更新后可用'}}</p></div><button class="btn" :disabled="busy||!ready||!state.agent?.previousVersion" @click="plan('rollback')"><RotateCcw :size="15"/>回退</button></div><div class="setting-foot">安装失败会尝试恢复原镜像和数据。回退会恢复更新前的数据快照，其中包含当时的配置。</div></section>
    </div>
    <section v-if="state.latest" class="panel release-notes"><div class="panel-head"><h2>{{state.latest.name}} · 发布说明</h2><a class="text-button" :href="state.latest.url" target="_blank" rel="noopener noreferrer">GitHub Release<ArrowUpRight :size="15"/></a></div><p>{{state.latest.notes||'此版本没有填写发布说明。'}}</p></section>
    <section v-if="confirmation" class="panel update-confirm" role="region" aria-label="确认版本操作"><h2>{{confirmation.action==='rollback'?'确认回退版本':'确认安装更新'}}</h2><p class="version-transition">v{{confirmation.currentVersion}} <span>→</span> {{confirmation.tag}}</p><p>{{confirmation.action==='rollback'?confirmation.notes:'执行器将下载并校验镜像、备份当前数据，随后重启种子港。下载器会继续运行。'}}</p><p class="field-note">应用重启后可能需要重新登录。确认页面有效期 10 分钟。</p><div><button class="btn" @click="confirmation=null" :disabled="busy">取消</button><button class="btn primary" @click="apply" :disabled="busy||!ready">{{busy?'正在提交…':'确认并执行'}}</button></div></section>
  </div>
</template>
