<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDocs } from '../../state/docs'
import { flattenTree, indexTree } from '../../lib/tree'
import { depthOf, parentOf } from '../../lib/treeNav'
import { matchQuery, tokenizeQuery } from '../../lib/search'
import { useIcon } from '../../lib/icons'
import type { BmNode } from '../../types'

const props = defineProps<{
  docId: string
  excludeId?: string
  filter?: (n: BmNode) => boolean
}>()
const emit = defineEmits<{ close: []; picked: [folderId: string] }>()

const docs = useDocs()
const icon = (name: string) => useIcon(name)
const query = ref('')

const doc = computed(() => (props.docId ? docs.byId(props.docId) : null))

const indexIdx = computed(() => {
  docs.treeVersion
  return doc.value ? indexTree(doc.value.root) : null
})

// expand ancestors of matches while filtering
const expandSet = computed(() => {
  const set = new Set<string>()
  const d = doc.value
  if (!d) return set
  const tokens = tokenizeQuery(query.value)
  if (!tokens.length) return set
  const idx = indexIdx.value!
  for (const n of flattenTree(d.root, d.collapsed)) {
    if (matchQuery(tokens, n.name)) {
      let cur = idx.parentOf.get(n.id)
      while (cur && cur.id !== d.root.id) {
        set.add(cur.id)
        cur = idx.parentOf.get(cur.id)
      }
    }
  }
  return set
})

const nodes = computed(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return []
  const tokens = tokenizeQuery(query.value)
  const parent = parentOf(d.root)
  let list = flattenTree(d.root, d.collapsed)
  if (tokens.length) {
    const set = new Set<string>()
    for (const n of list) if (matchQuery(tokens, n.name)) set.add(n.id)
    for (const id of [...set]) {
      let cur = parent.get(id)
      while (cur && cur !== d.root.id) {
        set.add(cur)
        cur = parent.get(cur)
      }
    }
    list = list.filter((n) => set.has(n.id))
  }
  return list.filter((n) => n.type === 'folder' && n.id !== props.excludeId && (props.filter?.(n) ?? true))
})

const depth = (id: string) => (doc.value ? depthOf(doc.value.root, id) : 0)

function pick(id: string): void {
  emit('picked', id)
  emit('close')
}
</script>

<template>
  <div class="fp" :data-ver="docs.treeVersion">
    <div class="fp-head">Choose a folder</div>
    <div class="fp-search">
      <component :is="icon('Folder')" :size="15" />
      <input v-model="query" placeholder="Filter folders…" autofocus />
    </div>
    <div class="fp-list">
      <button
        v-for="n in nodes"
        :key="n.id"
        class="fp-item"
        :style="{ paddingLeft: (depth(n.id) * 14 + 8) + 'px' }"
        @click="pick(n.id)"
      >
        <span :class="{ 'open-set': expandSet.has(n.id) }" class="fp-fold">
          <component :is="icon('Folder')" :size="15" />
        </span>
        <span class="nm">{{ n.name }}</span>
      </button>
      <div v-if="!nodes.length" class="fp-empty">No folders</div>
    </div>
  </div>
</template>

<style scoped>
.fp {
  display: flex;
  flex-direction: column;
  height: 380px;
}
.fp-head {
  padding: 18px 20px 0;
  font-size: 15px;
  font-weight: 600;
}
.fp-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 16px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text-3);
}
.fp-search:focus-within {
  border-color: var(--accent);
}
.fp-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
}
.fp-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
}
.fp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: var(--radius-s);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.fp-item:hover {
  background: var(--accent-soft);
}
.fp-item .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-fold.open-set {
  color: var(--accent);
}
.fp-empty {
  padding: 30px;
  text-align: center;
  color: var(--text-3);
}
</style>