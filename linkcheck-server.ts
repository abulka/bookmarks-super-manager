// Local, same-machine link-check proxy for the Vite dev/preview servers.
//
// A browser cannot read cross-origin HTTP status codes (no-cors fetches return
// opaque responses that resolve even on 404/410), so the client-side worker can
// only detect network-level failures — not "page gone" responses. This plugin
// exposes a same-origin endpoint that performs the actual HTTP request on the
// server (the user's own machine) and reports the real status. Nothing leaves
// the machine; it is only used while `npm run dev` / `npm run preview` is running.
import type { Plugin } from 'vite'
import { isPrivateFriendlyCodeHost } from './src/lib/url.js'

interface ProxyResult {
  ok: boolean
  status: number
  error: string | null
  note?: string
}

// Strong signals that a 200 response is actually a registrar/hosting *placeholder*
// page (parked domain, "buy this domain", "coming soon", "domain for sale") rather
// than the real site. Deliberately narrow: common technical phrases like "DNS
// configuration", "your domain is now ready" or "coming soon" appear on plenty of
// legitimate pages and must NOT trigger this.
const PARKED_MARKERS: RegExp[] = [
  /buy\s+this\s+domain/i,
  /domain\s+for\s+sale/i,
  /this\s+domain(?:\s+name)?\s+(?:is|has\s+been)\s+(?:parked|for\s+sale)/i,
  /parked\s+(?:by|with|page)/i,
  /(?:sedo|parkingcrew|godaddy|namecheap|register\.com)\b.*(?:parking|domain\s+for\s+sale)/i,
]

/** Read at most `max` bytes of the response body as text (then cancel the stream). */
async function readSample(res: Response, max = 65536): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (total + value.length >= max) {
        chunks.push(value.subarray(0, max - total))
        total = max
        break
      }
      chunks.push(value)
      total += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.length
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

function looksParked(sample: string): boolean {
  if (!sample) return false
  return PARKED_MARKERS.some((re) => re.test(sample))
}

// Node's fetch (undici) validates TLS strictly against its own CA store and
// rejects servers that serve an incomplete/misconfigured cert chain, even when
// browsers load them fine (browsers fill in the missing intermediate from the
// OS store or via AIA). Such a host is misconfigured, not gone — never dead.
const CERT_VERIFY_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_SIGNATURE_FAILURE',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'INVALID_CA',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

function isCertVerifyError(e: unknown): boolean {
  let cur: unknown = e
  for (let depth = 0; depth < 6 && cur !== null && typeof cur === 'object'; depth++) {
    const obj = cur as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof obj.code === 'string' && CERT_VERIFY_CODES.has(obj.code)) return true
    if (
      typeof obj.message === 'string' &&
      /unable to verify the first certificate|unable to get(?: local)? issuer certificate|certificate (?:has expired|not yet valid|verify failed)|self[- ]signed|leaf signature|does not match(?: the)? certificate|hostname[^.]* (?:does not match|mismatch)/i.test(
        obj.message,
      )
    )
      return true
    cur = obj.cause
  }
  return false
}

export async function checkUrl(url: string): Promise<ProxyResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    const status = res.status
    const contentType = res.headers.get('content-type') ?? ''
    // Only an explicit "gone" status means the page is truly dead. Anything else
    // (2xx, 3xx, and especially 401/403 bot-protection, 405, 429, 5xx) means the
    // host answered, so the link is reachable — we must NOT flag it dead.
    if (status === 404 || status === 410) {
      // A 404 on a code host can mean the repo is private (returns 404 to
      // anonymous clients), not deleted — treat as unverified, not dead.
      if (status === 404 && isPrivateFriendlyCodeHost(url)) {
        return { ok: true, status, error: null, note: 'unverified' }
      }
      return { ok: false, status, error: null }
    }
    // A 200 could be a registrar "domain for sale" / hosting placeholder page.
    // Sniff the body for parking markers when it looks like HTML.
    if (status >= 200 && status < 300 && /html|text\//i.test(contentType)) {
      const sample = await readSample(res)
      if (looksParked(sample)) {
        return { ok: false, status, error: null, note: 'parked' }
      }
    } else {
      // Not HTML (or not 2xx) — drop the body we don't need.
      await res.body?.cancel().catch(() => {})
    }
    return { ok: true, status, error: null }
  } catch (e) {
    // A hard abort is OUR timeout, not evidence the site is down: slow or
    // bot-shielded shops routinely take longer than an automated headless
    // fetch allows. Report it as reachable (unverified) rather than dead.
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') {
      return { ok: true, status: 0, error: null, note: 'timeout' }
    }
    // A TLS certificate-verification failure is a misconfigured host, not a
    // gone page — report it as unverified rather than dead.
    if (isCertVerifyError(e)) {
      return { ok: true, status: 0, error: null, note: 'tls' }
    }
    // Network-level failure (DNS, connection refused) → genuinely dead.
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

function linkcheckMiddleware(req: any, res: any, next: () => void): void {
  if (!req.url || !req.url.startsWith('/__linkcheck') || req.method !== 'POST') {
    next()
    return
  }
  let body = ''
  req.on('data', (chunk: any) => {
    body += chunk
  })
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body || '{}') as { url?: unknown }
      const url = parsed.url
      if (typeof url !== 'string' || !/^https?:/i.test(url)) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, status: 0, error: 'invalid url' } satisfies ProxyResult))
        return
      }
      const result = await checkUrl(url)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    } catch (e) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, status: 0, error: String(e) } satisfies ProxyResult))
    }
  })
}

export function linkcheckProxy(): Plugin {
  return {
    name: 'linkcheck-proxy',
    configureServer(server) {
      server.middlewares.use(linkcheckMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(linkcheckMiddleware)
    },
  }
}
