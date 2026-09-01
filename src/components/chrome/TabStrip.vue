<script setup lang="ts">
import { ref } from 'vue'
import { useDocs } from '../../state/docs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import Favicon from '../shared/Favicon.vue'
import { useDnd } from '../../state/dnd'
import { useClipboard } from '../../state/clipboard'

const docs = useDocs()
const ui = useUi()
const dnd = useDnd()
const clip = useClipboard()
const icon = (name: string) => useIcon(name)

const dragTab = ref<string>('')
const overTab = ref('')
const overIndex = ref(-1)

function onTabCtx(e: MouseEvent, docId: string): void {
  e.preventDefault()
  ui.openModal('editDoc', { docId, name: docs.byId(docId)?.fileName ?? '' })
}

function newTab(): void {
  docs.newBlankDoc()
}

function closeTab(docId: string): void {
  const doc = docs.byId(docId)
  if (!doc) return
  // closing a tab deletes the document from storage; warn when content has
  // changed since the last export/import and would be lost
  if (doc.dirty) {
    ui.openModal('confirm', {
      title: 'Close without exporting?',
      message: `“${doc.fileName}” has changes that haven't been exported. Closing the tab discards them — the file on disk is not updated.`,
      confirmLabel: 'Close and discard',
      danger: true,
      onConfirm: () => {
        if (clip.srcDocId === docId) clip.clear()
        docs.closeDoc(docId)
        ui.notify('info', `Closed ${doc.fileName}`)
      },
    })
    return
  }
  if (clip.srcDocId === docId) clip.clear()
  docs.closeDoc(docId)
  ui.notify('info', `Closed ${doc.fileName}`)
}

function onDragStart(e: DragEvent, docId: string): void {
  dragTab.value = docId
  e.dataTransfer?.setData('text/x-bm-tab', docId)
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, docId: string, index: number): void {
  if (!dragTab.value) return
  e.preventDefault()
  overTab.value = docId
  overIndex.value = index
  e.dataTransfer!.dropEffect = 'move'
}

function onDrop(e: DragEvent, docId: string): void {
  e.preventDefault()
  const from = e.dataTransfer?.getData('text/x-bm-tab') || dragTab.value
  if (!from || from === docId) return
  const fromIdx = docs.tabs.indexOf(from)
  const toIdx = docs.tabs.indexOf(docId)
  docs.tabs.splice(fromIdx, 1)
  const target = docs.tabs.indexOf(docId)
  docs.tabs.splice(target + (fromIdx < toIdx ? 0 : 0), 0, from)
  overTab.value = ''
  dragTab.value = ''
  docs.persistWorkspace()
}
</script>

<template>
  <div class="tab-strip no-select" :data-ver="docs.treeVersion">
    <button
      v-for="(t, i) in docs.tabs"
      :key="t"
      class="tab"
      :class="{ active: t === docs.activeDocId, dragging: dragTab === t }"
      draggable="true"
      @click="docs.activate(t)"
      @contextmenu.prevent="onTabCtx($event, t)"
      @dragstart="onDragStart($event, t)"
      @dragover.prevent="onDragOver($event, t, i)"
      @drop.prevent="onDrop($event, t)"
      @dragend="dragTab = ''"
    >
      <Favicon :url="docs.byId(t)?.root?.children?.[0]?.url" :name="docs.byId(t)?.fileName" :size="15" />
      <span class="tab-title">{{ docs.byId(t)?.fileName }}</span>
      <span class="tab-close" @click.stop="closeTab(t)">
        <component :is="icon('X')" :size="12" />
      </span>
    </button>
    <button class="tab-new" title="Open a new file" @click="newTab">
      <component :is="icon('Plus')" :size="17" />
    </button>
    <button
      v-if="dnd.session"
      class="tab-new"
      title="Open dragged content as a new file"
      @click="() => {}"
    />
  </div>
</template>

<style scoped>
.tab-strip {
  display: flex;
  align-items: flex-end;
  padding: 6px 8px 0;
  background: var(--chrome-line);
  border-bottom: 1px solid var(--border);
  position: relative;
  z-index: 5;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  gap: 1px;
}
.tab-strip::-webkit-scrollbar {
  display: none;
}
.tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 110px;
  max-width: 230px;
  height: 33px;
  padding: 0 9px;
  border-radius: 10px 10px 0 0;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-size: 12.5px;
  user-select: none;
  transition: background var(--speed) var(--ease), color var(--speed) var(--ease);
  white-space: nowrap;
  flex: 0 1 auto;
}
.tab:hover {
  background: var(--tab-hover);
  color: var(--text);
}
.tab.active {
  background: var(--bg);
  color: var(--text);
  border-color: var(--border);
  box-shadow: 0 -1px 4px rgba(0, 0, 0, 0.05);
}
.tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: var(--bg);
  z-index: 1;
}
.tab.dragging {
  opacity: 0.4;
}
.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.tab-close {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--text-3);
  opacity: 0;
  transition: opacity var(--speed) var(--ease), background var(--speed) var(--ease);
  flex: none;
}
.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--surface3);
  color: var(--text);
}
.tab-new {
  flex: none;
  width: 34px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 1px;
  transition: background var(--speed) var(--ease), color var(--speed) var(--ease);
}
.tab-new:hover {
  background: var(--tab-hover);
  color: var(--text);
}
</style>