<script setup lang="ts">
import { computed } from 'vue'
import { useDocs } from '../../state/docs'
import { useIcon } from '../../lib/icons'
import { crumbPath } from '../../lib/tree'

const props = defineProps<{ docId: string }>()
const docs = useDocs()
const icon = (name: string) => useIcon(name)

const crumbs = computed(() => {
  docs.treeVersion
  const d = docs.byId(props.docId)
  if (!d) return []
  return crumbPath(d.root, d.currentFolderId)
})
</script>

<template>
  <nav class="breadcrumbs no-select" :data-ver="docs.treeVersion">
    <template v-for="(c, i) in crumbs" :key="c.id">
      <span v-if="i > 0" class="crumb-sep"><component :is="icon('ChevronRight')" :size="13" /></span>
      <button class="crumb" :class="{ last: i === crumbs.length - 1 }" @click="docs.setCurrentFolder(docId, c.id)">
        {{ c.name }}
      </button>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 14px 4px;
  overflow: hidden;
  flex: none;
  min-height: 30px;
}
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: var(--radius-full);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  border: none;
  background: transparent;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* the store root has no single list view (bar and other are separate),
   so it never appears as a crumb — the trail is just clickable folders */
.crumb:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.crumb.last {
  color: var(--text);
  font-weight: 600;
}
.crumb-sep {
  color: var(--text-3);
  display: inline-flex;
  flex: none;
}
</style>