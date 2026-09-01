<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDocs } from '../../../state/docs'
import { useUi } from '../../../state/ui'
import type { BmNode } from '../../../types'
import { hostOf } from '../../../lib/url'

interface Payload {
  docId: string
  node: BmNode
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const docs = useDocs()
const ui = useUi()

const isLink = props.payload.node.type === 'link'
const name = ref(props.payload.node.name)
const url = ref(props.payload.node.url || '')
const urlInput = ref<HTMLInputElement>()

onMounted(() => {
  if (isLink) urlInput.value?.focus()
  else name.value
})

function save(): void {
  const { docId, node } = props.payload
  const trimmedName = name.value.trim() || (isLink ? 'Untitled' : 'New folder')
  if (trimmedName !== node.name) docs.mutRename(docId, node.id, trimmedName)
  if (isLink && url.value.trim() !== (node.url || '')) docs.mutSetUrl(docId, node.id, url.value.trim())
  emit('close')
  ui.notify('info', isLink ? 'Bookmark updated' : 'Folder renamed')
}
</script>

<template>
  <div class="modal">
    <div class="head">{{ isLink ? 'Edit bookmark' : 'Rename folder' }}</div>
    <div class="body">
      <label class="field">
        <span>Name</span>
        <input v-model="name" type="text" @keydown.enter="save" @keydown.esc="emit('close')" />
      </label>
      <label v-if="isLink" class="field">
        <span>URL</span>
        <input ref="urlInput" v-model="url" type="text" spellcheck="false" @keydown.enter="save" @keydown.esc="emit('close')" />
        <span class="hint">{{ hostOf(url) || 'paste a link' }}</span>
      </label>
    </div>
    <div class="foot">
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" @click="save">Save</button>
    </div>
  </div>
</template>

<style scoped>
.head {
  padding: 18px 22px 0;
  font-size: 15px;
  font-weight: 600;
}
.body {
  padding: 14px 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  font-weight: 500;
}
.hint {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 22px 18px;
}
</style>