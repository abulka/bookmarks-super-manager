/** Sample library files served from /public/samples (see samples/index.json). */

export async function loadSampleNames(): Promise<string[]> {
  try {
    const r = await fetch('/samples/index.json', { signal: AbortSignal.timeout(4000) })
    return r.ok ? ((await r.json()) as string[]) : []
  } catch {
    return []
  }
}

export async function fetchSampleText(name: string): Promise<string | null> {
  try {
    const r = await fetch(`/samples/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return null
    return await r.text()
  } catch {
    return null
  }
}