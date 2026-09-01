import { expect, it } from 'vitest'
import { groupByParent, indexTree, topmostIds } from '../src/lib/tree'
import type { BmNode } from '../src/types'

const t = Math.floor(Date.now() / 1000)
const folder = (name: string, id: string, kids: BmNode[] = []): BmNode => ({ id, type: 'folder', name, addDate: t, children: kids })

function fixture(): BmNode {
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [] }
  root.children.push(folder('F1', 'f1', [folder('S1', 's1'), folder('S2', 's2')]))
  root.children.push(folder('F2', 'f2'))
  return root
}

it('topmostIds drops ids that sit inside another selected id', () => {
  const { parentOf } = indexTree(fixture())
  expect(topmostIds(parentOf, ['f1', 's1'])).toEqual(['f1'])
  expect(topmostIds(parentOf, ['f1', 's1', 'f2'])).toEqual(['f1', 'f2'])
  expect(topmostIds(parentOf, ['s1', 's2'])).toEqual(['s1', 's2'])
  expect(topmostIds(parentOf, ['f2'])).toEqual(['f2'])
  expect(topmostIds(parentOf, [])).toEqual([])
})

it('groupByParent groups the topmost ids under their parents', () => {
  const { parentOf } = indexTree(fixture())
  expect(groupByParent(parentOf, ['f1', 's1', 'f2'])).toEqual([{ parentId: 'root', ids: ['f1', 'f2'] }])
  expect(groupByParent(parentOf, ['s1', 's2'])).toEqual([{ parentId: 'f1', ids: ['s1', 's2'] }])
  expect(groupByParent(parentOf, ['s1', 'f2'])).toEqual([
    { parentId: 'f1', ids: ['s1'] },
    { parentId: 'root', ids: ['f2'] },
  ])
})

it('groupByParent drops ids with no resolvable parent', () => {
  const { parentOf } = indexTree(fixture())
  expect(groupByParent(parentOf, ['ghost', 'f2'])).toEqual([{ parentId: 'root', ids: ['f2'] }])
  expect(groupByParent(parentOf, ['ghost'])).toEqual([])
})