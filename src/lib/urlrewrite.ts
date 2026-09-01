// Best-effort URL rewrites that turn known legacy/dead link shapes into their
// current equivalents. Returns the rewritten URL, or null if no rule applies.
//
// dpreview: legacy site was decommissioned (returns a Cloudflare block for every
// legacy URL). The forums moved to a new path that preserves the thread id and
// page, so we can reconstruct it. The human-readable slug is a placeholder — the
// site resolves threads by the numeric id, so the slug is cosmetic.
export function rewriteUrl(url: string): string | null {
  // legacy.dpreview.com/forums/thread/<ID>[?page=<N>]  ->  www host, new path
  const thread = url.match(/^https?:\/\/legacy\.dpreview\.com\/forums\/thread\/(\d+)(?:\?([^#]*))?/i)
  if (thread) {
    const id = thread[1]
    const q = thread[2] ?? ''
    const pm = q.match(/(?:^|&)page=(\d+)/i)
    const page = pm ? pm[1] : '1'
    return `https://www.dpreview.com/forums/threads/thread.${id}/page-${page}?page=${page}`
  }
  // best-effort: any other legacy.dpreview.com path -> current www host
  if (/^https?:\/\/legacy\.dpreview\.com\//i.test(url)) {
    return url.replace(/^https?:\/\/legacy\.dpreview\.com\//i, 'https://www.dpreview.com/')
  }
  return null
}
