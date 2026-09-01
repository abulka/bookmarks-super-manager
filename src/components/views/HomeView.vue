<script setup lang="ts">
import { computed, ref } from 'vue'
import { toRaw } from 'vue'
import { useDocs } from '../../state/docs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { walk } from '../../lib/tree'
import type { BmNode } from '../../types'
import Favicon from '../shared/Favicon.vue'

const props = defineProps<{ docId: string }>()
const docs = useDocs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const doc = computed(() => docs.byId(props.docId))
const q = ref('')

const toolbarFolder = computed<BmNode | null>(() => {
  const d = doc.value
  if (!d) return null
  return (
    d.root.children.find((c) => c.type === 'folder' && (c.attrs?.PERSONAL_TOOLBAR_FOLDER === 'true' || c.name.includes('Bookmarks bar'))) ??
    d.root.children.find((c) => c.type === 'folder') ??
    null
  )
})

const recent = computed(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return []
  const links: BmNode[] = []
  for (const n of walk(toRaw(d.root))) if (n.type === 'link' && n.addDate) links.push(n)
  links.sort((a, b) => (b.addDate ?? 0) - (a.addDate ?? 0))
  return links.slice(0, 8)
})

const topFolders = computed(() => {
  const d = doc.value
  if (!d) return []
  return d.root.children.filter((c) => c.type === 'folder')
})

const stats = computed(() => {
  docs.treeVersion
  return doc.value ? docs.statsFor(doc.value.id) : null
})

function folderCount(n: BmNode): number {
  const d = doc.value
  if (!d) return 0
  let c = 0
  const stk = [n]
  while (stk.length) {
    const cur = stk.pop()!
    for (const ch of cur.children) {
      if (ch.type === 'link') c++
      else stk.push(ch)
    }
  }
  return c
}

function search(): void {
  const d = doc.value
  if (!d) return
  docs.setSearch(d.id, q.value)
}

function openUrl(n: BmNode): void {
  if (n.url) window.open(n.url, '_blank', 'noopener')
}
</script>

<template>
  <div v-if="doc" class="home" :data-ver="docs.treeVersion">
    <div class="home-hero">
      <div class="logo">
        <component :is="icon('Bookmark')" :size="22" />
      </div>
      <h1>Bookmarks</h1>
      <p class="sub">
        <b>{{ stats?.links }}</b> bookmarks · <b>{{ stats?.folders }}</b> folders
        <template v-if="stats?.duplicateGroups"> · <b>{{ stats.duplicateGroups }}</b> duplicate groups</template>
        <template v-if="stats?.deadLinks"> · <b class="warn">{{ stats.deadLinks }}</b> dead</template>
      </p>
      <div class="home-search">
        <component :is="icon('Search')" :size="18" />
        <input
          v-model="q"
          placeholder="Search all bookmarks…"
          spellcheck="false"
          @keydown.enter="search"
        />
        <button v-if="q" class="go" @click="search"><component :is="icon('ArrowRight')" :size="16" /></button>
      </div>
      <div class="quick">
        <button class="quick-chip" @click="docs.setView(doc.id, 'manager')">
          <component :is="icon('ListTree')" :size="14" /> Manager
        </button>
        <button class="quick-chip" @click="docs.setView(doc.id, 'dupes')">
          <component :is="icon('Copy')" :size="14" /> Duplicates
        </button>
        <button class="quick-chip" @click="docs.setView(doc.id, 'dead')">
          <component :is="icon('Skull')" :size="14" /> Dead links {{ stats?.deadLinks ? `(${stats.deadLinks})` : '' }}
        </button>
        <button class="quick-chip" @click="ui.openModal('export', { docId: doc.id })">
          <component :is="icon('Download')" :size="14" /> Export
        </button>
      </div>
    </div>

    <div class="home-body">
      <section v-if="toolbarFolder?.children?.length">
        <h2 class="sec-title">Bookmarks bar</h2>
        <div class="chip-strip">
          <button
            v-for="n in toolbarFolder.children"
            :key="n.id"
            class="bar-chip"
            @click="n.type === 'folder' ? docs.setCurrentFolder(doc.id, n.id) : openUrl(n)"
          >
            <Favicon :url="n.url" :name="n.name" :size="16" />
            <span class="truncate">{{ n.name }}</span>
            <span v-if="n.type === 'folder'" class="bc-count">{{ folderCount(n) }}</span>
          </button>
        </div>
      </section>

      <section>
        <h2 class="sec-title">Recently added</h2>
        <div class="recent-list">
          <button v-for="n in recent" :key="n.id" class="recent-row" @click="openUrl(n)">
            <Favicon :url="n.url" :name="n.name" :size="18" />
            <span class="rr-name truncate">{{ n.name }}</span>
            <span class="rr-date">{{ new Date((n.addDate || 0) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }) }}</span>
          </button>
        </div>
      </section>

      <section>
        <h2 class="sec-title">Folders</h2>
        <div class="home-grid">
          <button
            v-for="n in topFolders"
            :key="n.id"
            class="home-card"
            @click="docs.setCurrentFolder(doc.id, n.id)"
          >
            <span class="folder-tile"><component :is="icon('Folder')" :size="17" /></span>
            <span class="hc-body">
              <span class="hc-name truncate">{{ n.name }}</span>
              <span class="hc-count">{{ folderCount(n) }} links</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.home-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 34px 24px 22px;
  text-align: center;
}
.logo {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--accent), #7c4dff);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 10px 30px rgba(90, 141, 255, 0.35);
  margin-bottom: 6px;
}
.home-hero h1 {
  margin: 8px 0 2px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.home-hero .sub {
  margin: 0 0 18px;
  color: var(--text-2);
  font-size: 13px;
}
.home-hero .sub .warn {
  color: var(--danger);
}
.home-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(560px, calc(100vw - 48px));
  height: 46px;
  padding: 0 16px;
  border-radius: var(--radius-full);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  color: var(--text-3);
  transition: border-color 150ms, box-shadow 150ms;
}
.home-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-softer), var(--shadow-md);
}
.home-search input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  color: var(--text);
  font-size: 15px;
  min-width: 0;
}
.go {
  border: none;
  background: var(--accent);
  color: #fff;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: none;
}
.quick {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.quick-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 120ms;
}
.quick-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.home-body {
  padding: 6px 28px 80px;
  max-width: 1080px;
  margin: 0 auto;
}
section {
  margin-bottom: 26px;
}
.sec-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-3);
  margin: 0 0 10px;
}
.chip-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.bar-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 120ms;
  max-width: 220px;
}
.bar-chip:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.bc-count {
  font-size: 10.5px;
  color: var(--text-3);
  background: var(--surface3);
  border-radius: 999px;
  padding: 0 6px;
  height: 15px;
  line-height: 15px;
}
.recent-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 6px;
}
.recent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: 9px;
  border: none;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  transition: all 120ms;
  text-align: left;
}
.recent-row:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.rr-name {
  flex: 1;
  font-size: 12.5px;
}
.rr-date {
  color: var(--text-3);
  font-size: 11px;
  flex: none;
}
.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.home-card {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border-radius: var(--radius-m);
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  transition: all 140ms var(--ease);
  text-align: left;
}
.home-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.hc-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.hc-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.hc-count {
  font-size: 11px;
  color: var(--text-3);
}
</style>