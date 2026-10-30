<script setup>
import {computed} from 'vue';
import {RefreshCw,AlertTriangle,ChevronRight} from 'lucide-vue-next';
import {limitNotice} from './limit-status.mjs';
const props=defineProps({status:Object});
const emit=defineEmits(['inspect']);
const notice=computed(()=>limitNotice(props.status));
</script>
<template>
  <div v-if="notice.progress||notice.issues" class="limit-status-notice">
    <div v-if="notice.progress" class="limit-progress" role="status"><RefreshCw :size="16"/><span>{{notice.progress}}<small>确认后自动更新，正常执行无需处理。</small></span></div>
    <button v-if="notice.issues" class="limit-issue" @click="emit('inspect')"><AlertTriangle :size="17"/><span>{{notice.issues}}<small>需要核对限速结果 · 查看记录与任务详情</small></span><ChevronRight :size="16"/></button>
  </div>
</template>
