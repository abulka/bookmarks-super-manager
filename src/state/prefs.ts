import { defineStore } from 'pinia'

export type Theme = 'dark' | 'light'

interface Prefs {
  theme: Theme
  showBookmarksBar: boolean
  frame: 'browser' | 'classic'
  confirmOnDelete: boolean
}

export const usePrefs = defineStore('prefs', {
  state: (): Prefs => ({
    theme: 'dark',
    showBookmarksBar: true,
    frame: 'browser',
    confirmOnDelete: true,
  }),
  actions: {
    setTheme(t: Theme) {
      this.theme = t
      document.documentElement.dataset.theme = t
    },
    toggleTheme() {
      const next: Theme = this.theme === 'dark' ? 'light' : 'dark'
      this.setTheme(next)
    },
    hydrate(p: Partial<Prefs>) {
      if (p.theme) this.theme = p.theme
      if (typeof p.showBookmarksBar === 'boolean') this.showBookmarksBar = p.showBookmarksBar
      if (p.frame) this.frame = p.frame
      if (typeof p.confirmOnDelete === 'boolean') this.confirmOnDelete = p.confirmOnDelete
    },
  },
})