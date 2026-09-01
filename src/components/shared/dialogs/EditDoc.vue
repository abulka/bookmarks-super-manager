<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDocs } from '../../../state/docs'

interface Payload {
  docId: string
  name: string
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const docs = useDocs()
const name = ref(props.payload.name)
const input = ref<HTMLInputElement>()

onMounted(() => {
  input.value?.focus()
  input.value?.select()
})

function save(): void {
  const t = name.value.trim()
  if (t && t !== props.payload.name) docs.renameDoc(props.payload.docId, t)
  emit('close')
}
</script>

<template>
  <div class="modal">
    <div class="head">Rename tab</div>
    <div class="body">
      <label class="field">
        <span>File name</span>
        <input ref="input" v-model="name" type="text" @keydown.enter="save" @keydown.esc="emit('close')" />
      </label>
    </div>
    <div class="foot">
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" @click="save">Rename</button>
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