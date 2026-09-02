// Netlify Function mirroring the local dev/preview link-check proxy
// (linkcheck-server.ts) so a deployed static site can read real HTTP status
// codes instead of only network-level reachability.
//
// Client contract matches /__linkcheck: POST { url } -> { ok, status, error?, note? }

// Strong signals that a 200 response is actually a registrar/hosting *placeholder*
// page (parked domain, "buy this domain", "coming soon") rather than the real site.
const PARKED_MARKERS = [
  /buy\s+this\s+domain/i,
  /this\s+domain(?:\s+name)?\s+(?:is|has\s+been)\s+(?:for\s+sale|available|registered|parked)/i,
  /domain\s+for\s+sale/i,
  /your\s+domain\s+is\s+(?:now\s+)?ready/i,
  /(?:web\s+)?site\s+(?:is\s+)?(?:temporarily\s+)?(?:under\s+construction|coming\s+soon|parked)/i,
  /this\s+site\s+is\s+(?:temporarily\s+)?(?:under\s+construction|coming\s+soon)/i,
  /parked\s+(?:by|with|page)/i,
  /(?:sedo|parkingcrew|godaddy|namecheap|register\.com|nic\.[a-z]+)\b.*(?:parking|domain\s+for\s+sale|this\s+domain)/i,
  /dns\s+(?:parking|management|configuration)/i,
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

async function checkUrl(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
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
