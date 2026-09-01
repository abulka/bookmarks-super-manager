export interface Token {
  /** the lowercase literal to match */
  text: string
  /** true when the term was quoted, e.g. "pi" — must start a whole word */
  whole: boolean
}

/**
 * Split a raw query into tokens. Runs of whitespace separate tokens, except a
 * double-quoted span ("pi code") is kept as a single whole-word token.
 * Quoted tokens are marked whole (whole-word match); unquoted tokens match as
 * substrings. Example: `pi code` -> [pi, code] (substrings), `"pi" code` ->
 * [pi(whole), code(substring)].
 */
export function tokenizeQuery(raw: string): Token[] {
  const tokens: Token[] = []
  const s = raw.trim().toLowerCase()
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    if (s[i] === '"') {
      const start = ++i
      while (i < s.length && s[i] !== '"') i++
      const text = s.slice(start, i)
      if (text) tokens.push({ text, whole: true })
      if (i < s.length) i++ // skip the closing quote
    } else {
      const start = i
      while (i < s.length && !/\s/.test(s[i])) i++
      const text = s.slice(start, i)
      if (text) tokens.push({ text, whole: false })
    }
  }
  return tokens
}

const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether `token` matches `text`. Whole-word tokens match only when the token
 * is an exact whole word ("pi" -> "pi" but not "pixels"/"pick"/"pinterest");
 * unquoted tokens match as a plain substring anywhere.
 */
export function tokenMatches(token: Token, text: string): boolean {
  if (!token.text || !text) return false
  const s = text.toLowerCase()
  if (token.whole) {
    return new RegExp(`(?<=^|[^a-z0-9])${esc(token.text)}(?=$|[^a-z0-9])`).test(s)
  }
  return s.includes(token.text)
}

/**
 * Every token must match at least one of the given texts (e.g. the item's
 * name and/or URL). "pi code" matches an item that contains "pi" AND "code"
 * (each as a substring by default, or as a whole word when quoted).
 */
export function matchQuery(tokens: Token[], ...texts: string[]): boolean {
  if (!tokens.length) return false
  return tokens.every((t) => texts.some((s) => tokenMatches(t, s)))
}

/** 0-based [start, end) of the first occurrence of `token` in `text`, or null. */
export function findToken(token: Token, text: string): [number, number] | null {
  if (!token.text || !text) return null
  const s = text.toLowerCase()
  if (token.whole) {
    const m = new RegExp(`(?<=^|[^a-z0-9])${esc(token.text)}(?=$|[^a-z0-9])`).exec(s)
    if (!m) return null
    return [m.index, m.index + token.text.length]
  }
  const i = s.indexOf(token.text)
  return i < 0 ? null : [i, i + token.text.length]
}