<script setup lang="ts">
import { computed } from 'vue'
import { tileStyle } from '../../lib/favicon'

const props = defineProps<{
  url?: string
  name?: string
  size?: number
}>()

const tile = computed(() => tileStyle(props.url || '', props.name || '?'))
const style = computed(() => ({
  width: `${props.size ?? 18}px`,
  height: `${props.size ?? 18}px`,
  borderRadius: `${Math.round((props.size ?? 18) * 0.28)}px`,
}))
</script>

<template>
  <span class="favicon" :style="style">
    <span class="tile" :style="tile">{{ (name || url || '?')[0]?.toUpperCase() }}</span>
  </span>
</template>

<style scoped>
.favicon {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--surface3);
  overflow: hidden;
  flex: none;
  position: relative;
  display: inline-flex;
}
.tile {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: hsl(var(--tile-h), var(--tile-s, 55%), var(--tile-l, 46%));
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
</style>
