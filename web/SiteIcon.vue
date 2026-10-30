<script setup>
import { computed,ref,watch } from 'vue';
import { Waves } from 'lucide-vue-next';
import { poolIcon } from './site-icons.mjs';
const props=defineProps({pool:Object,rules:{type:Array,default:()=>[]},size:{type:Number,default:28}});
const icon=computed(()=>poolIcon(props.pool,props.rules)),failed=ref(false);watch(icon,()=>failed.value=false);
</script>
<template><span class="site-icon" :style="{width:size+'px',height:size+'px',color:pool?.color}"><img v-if="icon&&!failed" :src="'/site-icons/'+icon.id" alt="" :width="size" :height="size" loading="lazy" @error="failed=true"><Waves v-else :size="size*.75"/></span></template>
