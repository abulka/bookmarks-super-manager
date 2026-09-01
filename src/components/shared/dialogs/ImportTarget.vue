<script setup lang="ts">
import { ref } from 'vue'
import { useDocs } from '../../../state/docs'
import { useUi } from '../../../state/ui'
import { useIcon } from '../../../lib/icons'
import { importFromText, readFileAsText } from '../../../lib/io'
import { findNode } from '../../../lib/tree'
import { cloneNodes } from '../../../lib/mutations'
import type { BmNode } from '../../../types'
import FolderPicker from '../FolderPicker.vue'

interface Payload {
  docId: string
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const docs = useDocs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const targetFolder = ref('')
const showPicker = ref(false)
const fileInput = ref<HTMLInputElement>()

function pickFolder(folderId: string): void {
  targetFolder.value = folderId
  showPicker.value = false
}

function insertSubtree(docId: string, folderId: string, children: BmNode[]): void {
  const doc = docs.byId(docId)
  if (!doc) return
  const target = findNode(doc.root, folderId)
  if (!target) return
  const u = docs.undoOf(docId)
  // re-id all imported nodes to avoid collisions
  const cloned = cloneNodes(children)
  const startIndex = target.children.length
  target.children.push(...cloned)
  u.push({
    label: 'Import',
    undo: () => {
      target.children.length = startIndex
    },
    redo: () => {
      target.children.push(...cloned)
    },
  })
  docs.touch(docId)
}

async function onPickFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  const doc = docs.byId(props.payload.docId)
  if (!doc) return
  const folderId = targetFolder.value || doc.root.id
  for (const file of files) {
    try {
      const text = await readFileAsText(file)
      const out = importFromText(text, file.name)
      if (out.format === 'unknown') {
        ui.notify('error', `Could not read ${file.name}`)
        continue
      }
      insertSubtree(doc.id, folderId, out.root.children)
      ui.notify('success', `Imported ${out.links} bookmarks from ${file.name}`)
    } catch (err) {
      ui.notify('error', `Failed to import ${file.name}`)
      console.error(err)
    }
  }
  emit('close')
}
</script>

<template>
  <div class="modal">
    <div class="head">
      <component :is="icon('Download')" :size="18" />
      <span>Import into this file</span>
    </div>
    <div class="body">
      <label class="field">
        <span>Target folder</span>
        <button class="target" @click="showPicker = true">
          <component :is="icon('Folder')" :size="15" />
          <span class="nm" :class="{ muted: !targetFolder }">{{ targetFolder ? findNode(docs.byId(payload.docId)?.root!, targetFolder)?.name ?? '…' : 'Top of the file' }}</span>
          <component :is="icon('ChevronRight')" :size="14" />
        </button>
      </label>
      <input ref="fileInput" type="file" multiple accept=".html,.htm,.json" style="display: none" @change="onPickFiles" />
      <button class="btn primary" @click="fileInput?.click()">
        <component :is="icon('Upload')" :size="15" />
        Choose file(s) to merge in
      </button>
      <p class="note">Content is merged under the chosen folder; source files stay untouched.</p>
    </div>
    <div class="foot">
      <button class="btn" @click="emit('close')">Close</button>
    </div>
    <FolderPicker v-if="showPicker" :doc-id="payload.docId" @close="showPicker = false" @picked="pickFolder" />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 18px 22px 0;
  font-size: 15px;
  font-weight: 600;
}
.body {
  padding: 14px 22px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  font-weight: 500;
}
.target {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-m);
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text);
  cursor: pointer;
}
.target:hover {
  border-color: var(--accent);
}
.nm {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--text-3);
}
.note {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-3);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 22px 16px;
}
</style>