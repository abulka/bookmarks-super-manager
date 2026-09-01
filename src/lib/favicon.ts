import { hueOf } from './url'

export function initialOf(name: string): string {
  const t = name.trim()
  return (t[0] || '?').toUpperCase()
}

/** HSL color for the letter tile. */
export function tileStyle(url: string, name: string): Record<string, string> {
  const h = url ? hueOf(url) : hueOf(name || '?', 1)
  return {
    '--tile-h': String(h),
    '--tile-s': '55%',
    '--tile-l': '46%',
  }
}
