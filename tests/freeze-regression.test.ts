import { describe, expect, it } from 'vitest'
import { uid } from '../src/lib/id'
import { findDuplicates, folderCounts, namePath } from '../src/lib/tree'
import type { BmNode } from '../src/types'

describe('uid', () => {
  it('never collides at import scale (~15k ids in one session)', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 15000; i++) ids.add(uid())
    expect(ids.size).toBe(15000)
  })

  it('uses a fixed-width counter field so short counters cannot alias long ones', () => {
    const a = uid()
    const b = uid()
    const aCounter = a.slice(a.length - 8, a.length - 2)
    const bCounter = b.slice(b.length - 8, b.length - 2)
    expect(aCounter).toMatch(/^[0-9a-z]{6}$/)
    expect(aCounter).not.toBe(bCounter)
  })
})

describe('findDuplicates against corrupt (duplicate-id) trees', () => {
  // Legacy docs saved before the uid() fix can contain two nodes sharing one
  // id. If one is an ancestor of the other, the id-keyed parent map cycles;
  // the path walk must terminate instead of freezing the tab.
  const f = 1
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', children: [] }
  const favs: BmNode = { id: 'dup', type: 'folder', name: 'Favs', addDate: f, children: [] }
  const docs: BmNode = { id: 'gdocs', type: 'folder', name: 'Google Docs', addDate: f, children: [] }
  // "Google Docs" sits INSIDE "Favs" and re-uses its id
  docs.children.push({ id: 'dup', type: 'link', name: 'X', url: 'https://same.example/', addDate: f, children: [] })
  docs.children.push({ id: 'y', type: 'link', name: 'Y', url: 'https://same.example/', addDate: f, children: [] })
  favs.children.push(docs)
  root.children.push(favs)

  it('terminates and still reports the duplicate URL group', () => {
    const report = findDuplicates(root)
    expect(report.groups.length).toBe(1)
    expect(report.groups[0].members.length).toBe(2)
    expect(report.uniqueUrls).toBe(1)
  })

  it('produces finite parent paths for every member', () => {
    const report = findDuplicates(root)
    for (const m of report.groups[0].members) {
      expect(m.path.length).toBeLessThan(10)
      m.parentPathNames.forEach((n) => expect(typeof n).toBe('string'))
    }
  })
})

describe('namePath with cyclic parent map', () => {
  it('returns without hanging when ids repeat along the chain', () => {
    const f = 1
    const root: BmNode = { id: 'root', type: 'folder', name: '(root)', children: [] }
    const a: BmNode = { id: 'same', type: 'folder', name: 'A', addDate: f, children: [] }
    const b: BmNode = { id: 'same', type: 'folder', name: 'B', addDate: f, children: [] }
    a.children.push(b)
    root.children.push(a)
    const link: BmNode = { id: 'l', type: 'link', name: 'L', url: 'https://x.example/', addDate: f, children: [] }
    b.children.push(link)
    expect(namePath(root, 'l').length).toBeLessThan(10)
  })
})

describe('folderCounts', () => {
  it('counts links and dead links per folder in one pass', () => {
    const f = 1
    const mkLink = (id: string, dead = false): BmNode => ({ id, type: 'link', name: id, url: 'https://x.example/', addDate: f, dead, children: [] })
    const sub: BmNode = { id: 'sub', type: 'folder', name: 'Sub', addDate: f, children: [mkLink('s1'), mkLink('s2', true)] }
    const top: BmNode = { id: 'top', type: 'folder', name: 'Top', addDate: f, children: [mkLink('t1', true), sub] }
    const root: BmNode = { id: 'root', type: 'folder', name: '(root)', children: [top] }
    const counts = folderCounts(root)
    expect(counts.get('sub')).toEqual({ links: 2, dead: 1 })
    expect(counts.get('top')).toEqual({ links: 3, dead: 2 })
  })
})
