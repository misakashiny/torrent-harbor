<script setup>
import { ref,computed } from 'vue';
import { Search,Check } from 'lucide-vue-next';
import { icons,poolIcon } from './site-icons.mjs';
import SiteIcon from './SiteIcon.vue';
const props=defineProps({modelValue:String,name:String,id:String,rules:Array});const emit=defineEmits(['update:modelValue']);
const query=ref(''),expanded=ref(false);
const filtered=computed(()=>icons.filter(i=>i.name.toLowerCase().includes(query.value.trim().toLowerCase())));
const auto=computed(()=>poolIcon({id:props.id,name:props.name,icon:'auto'},props.rules||[]));
const current=computed(()=>props.modelValue===''?'通用图标':props.modelValue==='auto'||!props.modelValue?'自动匹配'+(auto.value?' · '+auto.value.name:''):icons.find(i=>i.id===props.modelValue)?.name||'自动匹配');
</script>
<template><fieldset class="icon-picker"><legend>站点图标</legend><div class="icon-picker-current"><SiteIcon :pool="{id,name,icon:modelValue}" :rules="rules" :size="28"/><span>{{current}}</span><button type="button" class="btn small" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起图标':'选择图标'}}</button></div><template v-if="expanded"><div class="icon-modes"><button type="button" class="btn small" :aria-pressed="modelValue==='auto'" @click="emit('update:modelValue','auto')">自动匹配</button><button type="button" class="btn small" :aria-pressed="modelValue===''" @click="emit('update:modelValue','')">通用图标</button></div><div class="search-field"><Search :size="16"/><input v-model="query" aria-label="搜索站点图标" placeholder="搜索站点英文名，如 mteam、hdsky"></div><div class="icon-grid"><button v-for="icon in filtered" :key="icon.id" type="button" :title="icon.name" :aria-label="'选择 '+icon.name+' 图标'" :aria-pressed="modelValue===icon.id" @click="emit('update:modelValue',icon.id)"><img :src="'/site-icons/'+icon.id" alt="" width="24" height="24" loading="lazy"><span>{{icon.name}}</span><Check v-if="modelValue===icon.id" :size="12"/></button><p v-if="!filtered.length">没有找到，试试站点英文名。</p></div><small class="field-note">{{icons.length}} 个图标随程序提供，无需连接站点。来源：PT-depiler。</small></template></fieldset></template>
