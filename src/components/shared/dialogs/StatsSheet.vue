<script setup lang="ts">
import { computed } from 'vue'
import { useDocs } from '../../../state/docs'
import { useIcon } from '../../../lib/icons'
import { walk } from '../../../lib/tree'
import type { BmNode } from '../../../types'
import Favicon from '../Favicon.vue'

interface Payload {
  docId: string
}
const props = defineProps<{ payload: Payload }>()
const docs = useDocs()
const icon = (name: string) => useIcon(name)

const doc = computed(() => docs.byId(props.payload.docId))
const stats = computed(() => (doc.value ? docs.statsFor(doc.value.id) : null))

const topFolders = computed(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return []
  const out = d.root.children
    .filter((c) => c.type === 'folder')
    .map((f) => {
      let links = 0
      let folders = 0
      for (const n of walk(f)) {
        if (n.type === 'link') links++
        else folders++
      }
      return { node: f, links, folders }
    })
    .sort((a, b) => b.links - a.links)
  return out
})

const largest = computed(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return []
  const out: { n: BmNode; count: number }[] = []
  for (const n of walk(d.root)) {
    if (n.type !== 'folder') continue
    let c = 0
    for (const x of walk(n)) if (x.type === 'link') c++
    out.push({ n, count: c })
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 8)
})

const recent = computed(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return []
  const links: BmNode[] = []
  for (const n of walk(d.root)) if (n.type === 'link' && n.addDate) links.push(n)
  links.sort((a, b) => (b.addDate ?? 0) - (a.addDate ?? 0))
  return links.slice(0, 6)
})
</script>

<template>
  <div class="stats" :data-ver="docs.treeVersion">
    <div class="stats-head">
      <component :is="icon('BarChart2')" :size="18" />
      <span>Library stats</span>
      <button class="icon-btn menu-close" @click="$emit('close')"><component :is="icon('X')" :size="15" /></button>
    </div>
    <div class="stats-body">
      <div class="kpi-row">
        <div class="kpi"><b>{{ stats?.links }}</b><span>bookmarks</span></div>
        <div class="kpi"><b>{{ stats?.folders }}</b><span>folders</span></div>
        <div class="kpi"><b>{{ stats?.uniqueUrls }}</b><span>unique URLs</span></div>
        <div class="kpi warn"><b>{{ stats?.duplicateGroups }}</b><span>dup groups</span></div>
        <div class="kpi danger"><b>{{ stats?.deadLinks }}</b><span>dead</span></div>
      </div>

      <h3>Top-level folders</h3>
      <div class="table">
        <div v-for="(f, i) in topFolders" :key="f.node.id" class="row">
          <span class="rank">{{ i + 1 }}</span>
          <span class="name truncate">{{ f.node.name }}</span>
          <span class="bar"><span class="fill" :style="{ width: (f.links / (topFolders[0]?.links || 1) * 100) + '%' }" /></span>
          <span class="num">{{ f.links }}</span>
        </div>
      </div>

      <h3>Largest folders</h3>
      <div class="chips">
        <span v-for="l in largest" :key="l.n.id" class="tchip">
          <component :is="icon('Folder')" :size="12" /> {{ l.n.name }} <b>{{ l.count }}</b>
        </span>
      </div>

      <h3>Recently added</h3>
      <div class="recent">
        <div v-for="n in recent" :key="n.id" class="rrow">
          <Favicon :url="n.url" :name="n.name" :size="16" />
          <span class="truncate">{{ n.name }}</span>
          <span class="date">{{ new Date((n.addDate || 0) * 1000).toLocaleDateString() }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats {
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
}
.stats-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 16px 18px 8px;
  font-size: 15px;
  font-weight: 650;
  color: var(--text);
}
.menu-close {
  margin-left: auto;
}
.stats-body {
  padding: 4px 18px 18px;
  overflow-y: auto;
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin: 8px 0 4px;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  border-radius: var(--radius-m);
  background: var(--surface2);
  border: 1px solid var(--border);
}
.kpi b {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}
.kpi span {
  font-size: 11px;
  color: var(--text-3);
}
.kpi.warn b {
  color: var(--warn);
}
.kpi.danger b {
  color: var(--danger);
}
h3 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-3);
  margin: 18px 0 8px;
}
.table {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 26px;
  font-size: 12.5px;
}
.rank {
  flex: none;
  width: 20px;
  color: var(--text-3);
  font-size: 11px;
}
.name {
  flex: none;
  width: 180px;
  color: var(--text);
}
.bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--surface3);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-strong));
}
.num {
  flex: none;
  width: 44px;
  text-align: right;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface2);
  border: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-2);
}
.tchip b {
  color: var(--text);
}
.recent {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.rrow {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12.5px;
}
.rrow:hover {
  background: var(--surface-hover);
}
.rrow .truncate {
  flex: 1;
}
.date {
  color: var(--text-3);
  font-size: 11px;
}
</style>