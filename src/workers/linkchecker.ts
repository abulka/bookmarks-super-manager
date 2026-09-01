/// <reference lib="webworker" />
import { hostOf, isPrivateHost } from '../lib/url'

export type ProbeStatus = 'alive' | 'dead' | 'skipped'

export interface CheckResult {
  id: number
  url: string
  status: ProbeStatus
}

const CONCURRENCY = 18
const HEAD_TIMEOUT_MS = 7000
const GET_TIMEOUT_MS = 2500

// Same-origin endpoint (see app/linkcheck-server.ts) that performs a real
// server-side status check on the user's own machine. Returns a status only
// when the dev/preview server is running; otherwise we fall back to the
// network-level client check below.
const PROXY = '/__linkcheck'

let cancelled = false
let current: { urls: string[]; next: number } | null = null

/** Ask the local proxy for the real HTTP status. Returns null when unavailable. */
async function proxyCheck(url: string): Promise<ProbeStatus | null> {
  try {
    const r = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { ok: boolean; status?: number }
    return j.ok ? 'alive' : 'dead'
  } catch {
    return null
  }
}

/** Network-level liveness only — cannot see HTTP 4xx/5xx (opaque responses). */
async function clientCheck(url: string): Promise<ProbeStatus> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS)
    try {
      // no-cors keeps cross-origin fetches from throwing CORS errors while still
      // surfacing DNS / TLS / connection failures / server timeouts.
      await fetch(url, { method: 'HEAD', redirect: 'follow', mode: 'no-cors', cache: 'no-store', signal: controller.signal })
      return 'alive'
    } finally {
      clearTimeout(timer)
    }
  } catch (headError) {
    // quick GET fallback only for fast failures — a hanging HEAD is conclusive (dead)
    const fast = !(headError instanceof DOMException && headError.name === 'AbortError')
    try {
      if (!fast) return 'dead'
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), GET_TIMEOUT_MS)
      try {
        await fetch(url, { method: 'GET', redirect: 'follow', mode: 'no-cors', cache: 'no-store', signal: controller.signal })
        return 'alive'
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return 'dead'
    }
  }
}

async function probe(url: string): Promise<ProbeStatus> {
  if (!/^https?:/i.test(url)) return 'skipped'
  // Local / private / dev hosts (localhost, 127.0.0.1, 192.168.x, .local, …)
  // can't be verified — the dev server may simply not be running — so never
  // mark them dead; the apply step revives any stale ❌ on them.
  if (isPrivateHost(hostOf(url))) return 'skipped'
  // Prefer the accurate server-side status when the local proxy is available.
  const viaProxy = await proxyCheck(url)
  if (viaProxy) return viaProxy
  // Fallback: client-side network-level liveness (cannot see HTTP 4xx/5xx).
  return clientCheck(url)
}

self.onmessage = async (e: MessageEvent<{ type: 'run' | 'cancel'; urls?: string[]; runId?: string }>) => {
  if (e.data.type === 'cancel') {
    cancelled = true
    return
  }
  const { urls = [], runId = '' } = e.data
  cancelled = false
  current = { urls, next: 0 }
  let done = 0
  let batch = 0
  const results: CheckResult[] = []

  async function work(): Promise<void> {
    while (current && current.next < current.urls.length && !cancelled) {
      const i = current.next++
      const url = urls[i]
      try {
        results.push({ id: i, url, status: await probe(url) })
      } catch {
        results.push({ id: i, url, status: 'dead' })
      }
      done++
      if (++batch >= 24) {
        self.postMessage({ runId, done, total: urls.length, results })
        results.length = 0
        batch = 0
      }
    }
  }

  const runWorkers = Array.from({ length: Math.min(CONCURRENCY, urls.length || 1) }, () => work())
  await Promise.all(runWorkers)
  if (results.length) self.postMessage({ runId, done, total: urls.length, results })
  self.postMessage({ runId, done, total: urls.length, results: [], finished: true })
}