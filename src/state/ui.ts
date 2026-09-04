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
    /**
     * ttl === 0 → sticky: the toast stays until manually dismissed (the ✕ or
     * the action button). Critical situations (external-change conflicts,
     * partial Apply failures) use this; ordinary feedback keeps auto-dismissing.
     */
    notify(kind: Toast['kind'], text: string, action?: Toast['action'], ttl = 3500): void {
      const id = uid()
      this.toasts.push({ id, kind, text, action })
      if (ttl > 0) setTimeout(() => this.dismiss(id), ttl)
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