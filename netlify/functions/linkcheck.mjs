// Netlify Function mirroring the local dev/preview link-check proxy
// (linkcheck-server.ts) so a deployed static site can read real HTTP status
// codes instead of only network-level reachability.
//
// Client contract matches /__linkcheck: POST { url } -> { ok, status, error?, note? }

// Strong signals that a 200 response is actually a registrar/hosting *placeholder*
// page (parked domain, "buy this domain", "coming soon", "domain for sale") rather
// than the real site. Deliberately narrow: common technical phrases like "DNS
// configuration", "your domain is now ready" or "coming soon" appear on plenty of
// legitimate pages and must NOT trigger this.
const PARKED_MARKERS = [
  /buy\s+this\s+domain/i,
  /domain\s+for\s+sale/i,
  /this\s+domain(?:\s+name)?\s+(?:is|has\s+been)\s+(?:parked|for\s+sale)/i,
  /parked\s+(?:by|with|page)/i,
  /(?:sedo|parkingcrew|godaddy|namecheap|register\.com)\b.*(?:parking|domain\s+for\s+sale)/i,
]

// Code hosts return 404 to anonymous clients for PRIVATE repos (a privacy
// feature), so a 404 there can mean "private", not "deleted".
const CODE_HOSTS = ['github.com', 'gist.github.com', 'gitlab.com', 'bitbucket.org']

function isPrivateFriendlyCodeHost(input) {
  let h = ''
  try {
    h = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : 'https://' + input).hostname.toLowerCase()
  } catch {
    return false
  }
  return CODE_HOSTS.some((c) => h === c || h.endsWith('.' + c))
}

/** Read at most `max` bytes of the response body as text (then cancel the stream). */
async function readSample(res, max = 65536) {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks = []
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

function looksParked(sample) {
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

function isCertVerifyError(e) {
  let cur = e
  for (let depth = 0; depth < 6 && cur !== null && typeof cur === 'object'; depth++) {
    if (typeof cur.code === 'string' && CERT_VERIFY_CODES.has(cur.code)) return true
    if (
      typeof cur.message === 'string' &&
      /unable to verify the first certificate|unable to get(?: local)? issuer certificate|certificate (?:has expired|not yet valid|verify failed)|self[- ]signed|leaf signature|does not match(?: the)? certificate|hostname[^.]* (?:does not match|mismatch)/i.test(
        cur.message,
      )
    )
      return true
    cur = cur.cause
  }
  return false
}

export async function checkUrl(url) {
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
    if (status === 404 || status === 410) {
      if (status === 404 && isPrivateFriendlyCodeHost(url)) {
        return { ok: true, status, error: null, note: 'unverified' }
      }
      return { ok: false, status, error: null }
    }
    if (status >= 200 && status < 300 && /html|text\//i.test(contentType)) {
      const sample = await readSample(res)
      if (looksParked(sample)) {
        return { ok: false, status, error: null, note: 'parked' }
      }
    } else {
      await res.body?.cancel().catch(() => {})
    }
    return { ok: true, status, error: null }
  } catch (e) {
    // A hard abort is OUR timeout, not evidence the site is down: slow or
    // bot-shielded shops routinely take longer than an automated headless
    // fetch allows. Report it as reachable (unverified) rather than dead.
    if (typeof e === 'object' && e !== null && e?.name === 'AbortError') {
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

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, status: 0, error: 'method not allowed' }) }
  }
  let parsed
  try {
    parsed = JSON.parse(event.body || '{}')
  } catch {
    parsed = {}
  }
  const url = parsed.url
  if (typeof url !== 'string' || !/^https?:/i.test(url)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, status: 0, error: 'invalid url' }),
    }
  }
  const result = await checkUrl(url)
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  }
}
