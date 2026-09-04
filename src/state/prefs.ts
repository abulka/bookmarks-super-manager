import { defineStore } from 'pinia'

export type Theme = 'dark' | 'light'

interface Prefs {
  theme: Theme
  showBookmarksBar: boolean
  frame: 'browser' | 'classic'
  confirmOnDelete: boolean
  /** skip the "Apply to Chrome?" confirm entirely (resettable via settings) */
  skipApplyConfirm: boolean
}

export const usePrefs = defineStore('prefs', {
  state: (): Prefs => ({
    theme: 'dark',
    showBookmarksBar: true,
    frame: 'browser',
    confirmOnDelete: true,
    skipApplyConfirm: false,
  }),
  actions: {
    setTheme(t: Theme) {
      this.theme = t
      document.documentElement.dataset.theme = t
      this.persist()
    },
    toggleTheme() {
      const next: Theme = this.theme === 'dark' ? 'light' : 'dark'
      this.setTheme(next)
    },
    setShowBookmarksBar(v: boolean) {
      this.showBookmarksBar = v
      this.persist()
    },
    setConfirmOnDelete(v: boolean) {
      this.confirmOnDelete = v
      this.persist()
    },
    setSkipApplyConfirm(v: boolean) {
      this.skipApplyConfirm = v
      this.persist()
    },
    /** Save all preferences to idb-keyval (`bm.prefs.v1`). Best-effort. */
    persist() {
      const snapshot = {
        theme: this.theme,
        showBookmarksBar: this.showBookmarksBar,
        frame: this.frame,
        confirmOnDelete: this.confirmOnDelete,
        skipApplyConfirm: this.skipApplyConfirm,
      }
      void import('idb-keyval')
        .then(({ set }) => set('bm.prefs.v1', snapshot))
        .catch(() => {
          /* ignore persistence failures */
        })
    },
    hydrate(p: Partial<Prefs>) {
      if (p.theme) this.theme = p.theme
      if (typeof p.showBookmarksBar === 'boolean') this.showBookmarksBar = p.showBookmarksBar
      if (p.frame) this.frame = p.frame
      if (typeof p.confirmOnDelete === 'boolean') this.confirmOnDelete = p.confirmOnDelete
      if (typeof p.skipApplyConfirm === 'boolean') this.skipApplyConfirm = p.skipApplyConfirm
    },
  },
})