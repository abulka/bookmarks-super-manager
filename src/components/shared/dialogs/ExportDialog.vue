<script setup lang="ts">
import { ref } from 'vue'
import { useDocs } from '../../../state/docs'
import { useUi } from '../../../state/ui'
import { exportNetscape, exportJson } from '../../../exporter/netscape'
import { download } from '../../../lib/io'
import { useIcon } from '../../../lib/icons'
import type { BmNode } from '../../../types'

interface Payload {
  docId: string
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const docs = useDocs()
const ui = useUi()
const icon = (name: string) => useIcon(name)
const fname = ref(docs.byId(props.payload.docId)?.fileName ?? 'bookmarks.html')

function doExport(kind: 'html' | 'json' | 'all-html'): void {
  const doc = docs.byId(props.payload.docId)
  if (!doc) return
  const fn = fname.value
  if (kind === 'html') {
    download(fn.endsWith('.html') ? fn : fn + '.html', exportNetscape(doc.root, doc.title), 'text/html; charset=UTF-8')
    docs.markExported(doc.id)
  } else if (kind === 'json') {
    download(fn.replace(/\.html?$/i, '') + '.json', exportJson(doc.root), 'application/json')
    docs.markExported(doc.id)
  } else {
    const root: { id: string; type: 'folder'; name: string; children: BmNode[] } = { id: '__merge__', type: 'folder', name: '(root)', children: [] }
    for (const d of docs.docs) {
      for (const c of d.root.children) root.children.push(JSON.parse(JSON.stringify(c)) as BmNode)
    }
    download('all-bookmarks.html', exportNetscape(root, 'Bookmarks (merged)'), 'text/html; charset=UTF-8')
    // the merged file contains every document — all are safe on disk
    for (const d of docs.docs) docs.markExported(d.id)
  }
  emit('close')
  ui.notify('success', 'Exported')
}
</script>

<template>
  <div class="modal">
    <div class="head">
      <component :is="icon('Upload')" :size="18" />
      <span>Export bookmarks</span>
    </div>
    <div class="body">
      <label class="field">
        <span>File name</span>
        <input v-model="fname" type="text" spellcheck="false" />
      </label>
      <div class="opts">
        <button class="opt" @click="doExport('html')">
          <component :is="icon('Globe')" :size="20" />
          <div>
            <b>Netscape HTML</b>
            <small>Importable by Chrome, Firefox, Safari, Edge</small>
          </div>
        </button>
        <button class="opt" @click="doExport('json')">
          <component :is="icon('Files')" :size="20" />
          <div>
            <b>JSON</b>
            <small>Lossless backup of this document</small>
          </div>
        </button>
        <button class="opt" @click="doExport('all-html')" :disabled="docs.docs.length < 2">
          <component :is="icon('Layers')" :size="20" />
          <div>
            <b>Merge all tabs → HTML</b>
            <small v-if="docs.docs.length >= 2">{{ docs.docs.length }} documents combined</small>
            <small v-else>Open more than one file to enable</small>
          </div>
        </button>
      </div>
      <p class="note">Icons are not embedded; favicons are resolved at view time.</p>
    </div>
    <div class="foot">
      <button class="btn" @click="emit('close')">Close</button>
    </div>
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
.opts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-m);
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: all 120ms;
}
.opt:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.opt:disabled {
  opacity: 0.45;
  pointer-events: none;
}
.opt b {
  display: block;
  font-size: 13px;
}
.opt small {
  color: var(--text-3);
  font-size: 11.5px;
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