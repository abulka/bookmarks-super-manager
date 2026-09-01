let counter = 0
const COUNTER_WIDTH = 6 // 0xffffff fits exactly; fixed width keeps ids unambiguous
const RANDOM = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Collision-free id. The previous scheme appended a variable-width base-36
 * counter and padded the remainder with random chars, so different counters
 * could encode to the same string (counter 3 + pad "w" === counter 140 "3w").
 * Duplicate node ids make id-keyed parent maps cycle, which froze large
 * imports in an endless path walk. A zero-padded fixed-width counter field
 * can never alias another counter value.
 */
export function uid(): string {
  counter = (counter + 1) % 0xffffff
  const c = counter.toString(36).padStart(COUNTER_WIDTH, '0')
  let tail = ''
  for (let i = 0; i < 2; i++) tail += RANDOM[(Math.random() * RANDOM.length) | 0]
  return Date.now().toString(36) + c + tail
}
