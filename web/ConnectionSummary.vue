<script setup>
import { ChevronRight } from 'lucide-vue-next';

defineProps({ clients:Array, format:Function, time:Function });
const emit=defineEmits(['navigate']);
</script>

<template>
  <section class="panel overview-clients">
    <div class="panel-head">
      <h2>下载器状态</h2>
      <button class="text-button" data-connection-action="connections" @click="emit('navigate','clients')">查看连接<ChevronRight :size="15"/></button>
    </div>
    <div v-for="c in clients.slice(0,5)" :key="c.id" class="connection-row">
      <div>
        <strong><i class="dot" :class="c.online&&!c.stale?'green-dot':'warning-dot'"></i>{{c.name}}</strong>
        <small>{{c.type==='qb'?'qBittorrent':'Transmission'}} {{c.version}} · {{c.torrentCount.toLocaleString()}} 个种子</small>
      </div>
      <div>
        <strong>{{c.pending?'连接中':c.online&&!c.stale?'在线':c.online?'同步过期':'离线'}}</strong>
        <small v-if="c.online&&!c.stale">↓ {{format(c.download)}} · ↑ {{format(c.upload)}}</small>
        <small v-else>最后成功 {{time(c.time)}} · 当前速率未知</small>
      </div>
    </div>
    <button v-if="clients.length>5" class="show-all-connections text-button" data-connection-action="all" @click="emit('navigate','clients')">查看全部 {{clients.length}} 个下载器<ChevronRight :size="15"/></button>
    <p v-if="!clients.length" class="empty-message">尚无已启用的下载器，请在电脑端连接。</p>
  </section>
</template>
