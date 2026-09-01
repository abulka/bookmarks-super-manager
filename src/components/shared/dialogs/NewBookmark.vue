<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDocs } from '../../../state/docs'
import { useUi } from '../../../state/ui'
import { hostOf } from '../../../lib/url'

interface Payload {
  docId: string
  folderId: string
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const docs = useDocs()
const ui = useUi()
const name = ref('')
const url = ref('')
const nameInput = ref<HTMLInputElement>()

onMounted(() => nameInput.value?.focus())

function save(): void {
  const u = url.value.trim()
  if (!u) return
  const id = docs.mutCreateLink(props.payload.docId, props.payload.folderId, name.value.trim() || u, u)
  if (id) {
    emit('close')
    ui.notify('success', 'Bookmark added')
  }
}
</script>

<template>
  <div class="modal">
    <div class="head">New bookmark</div>
    <div class="body">
      <label class="field">
        <span>Name</span>
        <input ref="nameInput" v-model="name" type="text" @keydown.enter="save" @keydown.esc="emit('close')" />
      </label>
      <label class="field">
        <span>URL</span>
        <input v-model="url" type="text" spellcheck="false" placeholder="https://…" @keydown.enter="save" @keydown.esc="emit('close')" />
        <span v-if="url" class="hint">{{ hostOf(url) }}</span>
      </label>
    </div>
    <div class="foot">
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="!url.trim()" @click="save">Add</button>
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
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 22px 18px;
}
.btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>