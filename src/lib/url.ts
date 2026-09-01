const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'twclid', 'igshid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'spm',
])

export interface NormalizedUrl {
  host: string
  path: string
  query: string
  fragment: string
  raw: string
}

function canonicalize(input: string): NormalizedUrl {
  let raw = input.trim()
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) raw = 'https://' + raw
  let host = ''
  let path = '/'
  let query = ''
  let fragment = ''
  try {
    const u = new URL(raw)
    host = u.hostname.toLowerCase()
    const port = u.port && u.port !== '80' && u.port !== '443' ? ':' + u.port : ''
    host += port
    path = u.pathname || '/'
    query = u.search
    fragment = u.hash
  } catch {
    host = raw
  }
  return { host, path, query, fragment, raw }
}

/** Normalize a URL for duplicate detection: case/lower host, strip tracking, sort query params, strip default port. */
export function normalizeUrl(input: string): string {
  const u = canonicalize(input)
  let query = u.query
  if (query) {
    const params = new URLSearchParams(query)
    for (const k of Array.from(params.keys())) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) params.delete(k)
    }
    const sorted = Array.from(params.entries())
      .map(([k, v]) => `${k}=${v}`)
      .sort()
    query = sorted.length ? '?' + sorted.join('&') : ''
  }
  return `${u.host}${u.path.replace(/\/$/, '') || '/'}${query}${u.fragment}`
}

/** Bare hostname (no port) for favicon/site display. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0] || url
  }
}

/** Local / private / non-internet hosts — never resolvable to a public favicon. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!h) return true
  if (h === 'localhost') return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number)
    if (!p.every((x) => x <= 255)) return true
    const [a, b] = p
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return /\.(local|lan|internal|home|nas)$/.test(h) || h.indexOf('.') === -1
}

/** A stable color hue (0-360) derived from a hostname, used for fallback tiles. */
export function hueOf(url: string, salt = 0): number {
  const h = hostOf(url)
  let x = 0
  for (let i = 0; i < h.length; i++) x = (x * 31 + h.charCodeAt(i)) >>> 0
  return (x + salt * 137) % 360
}

// Code hosts return 404 to anonymous clients for PRIVATE repos (a privacy
// feature), so a 404 there can mean "private", not "deleted". We must not mark
// such links dead without auth.
const CODE_HOSTS = ['github.com', 'gist.github.com', 'gitlab.com', 'bitbucket.org']
export function isPrivateFriendlyCodeHost(input: string): boolean {
  let h = ''
  try {
    h = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : 'https://' + input).hostname.toLowerCase()
  } catch {
    return false
  }
  return CODE_HOSTS.some((c) => h === c || h.endsWith('.' + c))
}