export function formatDate(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diff = now - d.getTime()
  const day = 86400000
  if (diff < day && diff > -day) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 7 * day) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' })
}

export function formatDateLong(ts?: number): string {
  if (!ts) return 'Unknown'
  const d = new Date(ts * 1000)
  return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

export function timeAgo(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const diff = Date.now() - d.getTime()
  const min = 60000, hr = 3600000, day = 86400000
  if (diff < 0) return 'just now'
  if (diff < min) return 'just now'
  if (diff < hr) return `${Math.floor(diff / min)}m ago`
  if (diff < day) return `${Math.floor(diff / hr)}h ago`
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`
  return formatDate(ts)
}