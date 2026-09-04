import { defineStore } from 'pinia'
import { findNode } from '../lib/tree'
import { rewriteUrl } from '../lib/urlrewrite'
import { useDocs } from './docs'
import { isChromeExt } from '../lib/backend/chrome'
import type { CheckResult } from '../workers/linkchecker'

export interface CheckItem {
  id: string
  url: string
}

type Phase = 'idle' | 'running' | 'finished'

export const useChecker = defineStore('checker', {
  state: () => ({
    phase: 'idle' as Phase,
    docId: null as string | null,
    label: '',
    total: 0,
    done: 0,
    alive: 0,
    dead: 0,
    skipped: 0,
    deadIds: [] as string[],
    checkedIds: [] as string[],
    restored: 0,
    rewriteIds: [] as string[],
    rewritten: 0,
    worker: null as Worker | null,
    collect: false,
    runId: '',
  }),
  getters: {
    running(): boolean {
      return this.phase === 'running'
    },
    progress(): number {
      return this.total ? Math.min(1, this.done / this.total) : 0
    },
  },
  actions: {
    start(docId: string, items: CheckItem[], collect: boolean): void {
      this.cancel()
      const urls = items.map((i) => i.url)
      const idList = items.map((i) => i.id)

      this.phase = 'running'
      this.docId = docId
      this.label = `${items.length} links`
      this.total = urls.length
      this.done = 0
      this.alive = 0
      this.dead = 0
      this.skipped = 0
      this.deadIds = []
      this.checkedIds = idList
      this.restored = 0
      this.rewriteIds = []
      this.rewritten = 0
      this.collect = collect
      this.runId = String(Date.now())

      const w = new Worker(new URL('../workers/linkchecker.ts', import.meta.url), { type: 'module' })
      this.worker = w
      w.onmessage = (e: MessageEvent) => {
        const msg = e.data as { runId: string; results?: CheckResult[]; done?: number; finished?: boolean }
        if (msg.runId !== this.runId) return
        for (const r of msg.results ?? []) {
          if (r.status === 'dead') {
            // a dead link that matches a rewrite rule becomes a "rewrite", not a dead mark
            const url = r.id < urls.length ? urls[r.id] : ''
            const nr = url ? rewriteUrl(url) : null
            if (nr && nr !== url) {
              this.rewritten++
              if (r.id < idList.length) this.rewriteIds.push(idList[r.id])
            } else {
              this.dead++
              if (r.id < idList.length) this.deadIds.push(idList[r.id])
            }
          } else if (r.status === 'alive') {
            this.alive++
            // count links that were previously marked dead but are reachable now
            const d = this.docId ? useDocs().byId(this.docId) : null
            if (d && r.id < idList.length) {
              const node = findNode(d.root, idList[r.id])
              if (node?.dead) this.restored++
            }
          } else {
            this.skipped++
            // an unverifiable (e.g. local dev) link that was previously dead
            // will be revived on apply — count it as restored.
            const d = this.docId ? useDocs().byId(this.docId) : null
            if (d && r.id < idList.length) {
              const node = findNode(d.root, idList[r.id])
              if (node?.dead) this.restored++
            }
          }
        }
        if (msg.done != null) this.done = msg.done
        if (msg.finished) {
          w.terminate()
          this.worker = null
          this.phase = 'finished'
        }
      }
      w.postMessage({ type: 'run', urls, runId: this.runId, ext: isChromeExt() })
    },

    cancel(): void {
      if (this.worker) {
        this.worker.postMessage({ type: 'cancel' })
        this.worker.terminate()
        this.worker = null
      }
      if (this.phase === 'running') this.phase = 'finished'
    },

    reset(): void {
      this.phase = 'idle'
      this.docId = null
      this.label = ''
      this.runId = ''
      this.total = 0
      this.done = 0
      this.alive = 0
      this.dead = 0
      this.skipped = 0
      this.deadIds = []
      this.checkedIds = []
      this.restored = 0
      this.rewriteIds = []
      this.rewritten = 0
      this.worker = null
    },
  },
})

export type CheckerStore = ReturnType<typeof useChecker>