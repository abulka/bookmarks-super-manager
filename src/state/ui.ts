import { defineStore } from 'pinia'
import { uid } from '../lib/id'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  text: string
  action?: { label: string; onClick: () => void }
}

export const useUi = defineStore('ui', {
  state: () => ({
    toasts: [] as Toast[],
    modal: null as { kind: string; payload?: unknown } | null,
  }),
  actions: {
    notify(kind: Toast['kind'], text: string, action?: Toast['action'], ttl = 3500): void {
      const id = uid()
      this.toasts.push({ id, kind, text, action })
      setTimeout(() => this.dismiss(id), ttl)
    },
    dismiss(id: string): void {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },
    openModal(kind: string, payload?: unknown): void {
      this.modal = { kind, payload }
    },
    closeModal(): void {
      this.modal = null
    },
  },
})