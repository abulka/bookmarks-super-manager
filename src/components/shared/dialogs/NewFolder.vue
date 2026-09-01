<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDocs } from '../../../state/docs'
import { useUi } from '../../../state/ui'

interface Payload {
  docId: string
  folderId: string
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const docs = useDocs()
const ui = useUi()
const name = ref('')
const input = ref<HTMLInputElement>()

onMounted(() => input.value?.focus())

function save(): void {
  const id = docs.mutCreateFolder(props.payload.docId, props.payload.folderId, name.value.trim() || 'New folder')
  if (id) {
    emit('close')
    docs.setCurrentFolder(props.payload.docId, props.payload.folderId)
    ui.notify('success', 'Folder created')
  }
}
</script>

<template>
  <div class="modal">
    <div class="head">New folder</div>
    <div class="body">
      <label class="field">
        <span>Folder name</span>
        <input ref="input" v-model="name" type="text" @keydown.enter="save" @keydown.esc="emit('close')" />
      </label>
    </div>
    <div class="foot">
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" @click="save">Create</button>
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
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  font-weight: 500;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 22px 18px;
}
</style>