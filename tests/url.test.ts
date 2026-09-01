import { expect, it } from 'vitest'
import { isPrivateFriendlyCodeHost } from '../src/lib/url'

it('isPrivateFriendlyCodeHost detects github/gitlab/bitbucket (incl. subdomains)', () => {
  expect(isPrivateFriendlyCodeHost('https://github.com/abulka/js-03-chess-vue')).toBe(true)
  expect(isPrivateFriendlyCodeHost('http://gist.github.com/foo')).toBe(true)
  expect(isPrivateFriendlyCodeHost('https://gitlab.com/x/y')).toBe(true)
  expect(isPrivateFriendlyCodeHost('https://example.gitlab.com/x')).toBe(true)
  expect(isPrivateFriendlyCodeHost('https://bitbucket.org/x')).toBe(true)
  expect(isPrivateFriendlyCodeHost('https://example.com/foo')).toBe(false)
  expect(isPrivateFriendlyCodeHost('not a url')).toBe(false)
})
