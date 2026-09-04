import { expect, it } from 'vitest'
import { crumbPath } from '../src/lib/tree'
import type { BmNode } from '../src/types'

const t = Math.floor(Date.now() / 1000)
const folder = (name: string, id: string, kids: BmNode[] = [], attrs?: Record<string, string>): BmNode => ({
  id,
  type: 'folder',
  name,
  addDate: t,
  children: kids,
  ...(attrs ? { attrs } : {}),
})

function fixture(): BmNode {
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [] }
  root.children.push(folder('Bookmarks bar', 'bar', [folder('A', 'a'), folder('B', 'b')], { PERSONAL_TOOLBAR_FOLDER: 'true' }))
  root.children.push(folder('C', 'c', [folder('C1', 'c1')]))
  root.children.push(folder('D', 'd'))
  return root
}

it('the store root itself yields no crumbs (empty breadcrumb trail)', () => {
  expect(crumbPath(fixture(), 'root')).toEqual([])
})

it('folders under the bookmarks bar keep the real path', () => {
  expect(crumbPath(fixture(), 'bar')).toEqual([{ id: 'bar', name: 'Bookmarks bar' }])
  expect(crumbPath(fixture(), 'a')).toEqual([
    { id: 'bar', name: 'Bookmarks bar' },
    { id: 'a', name: 'A' },
  ])
})

it('non-bar top-level folders get the virtual "Other bookmarks" section', () => {
  expect(crumbPath(fixture(), 'c')).toEqual([
    { id: 'root', name: 'Other bookmarks' },
    { id: 'c', name: 'C' },
  ])
})

it('deeper non-bar folders keep the section at the front', () => {
  expect(crumbPath(fixture(), 'c1')).toEqual([
    { id: 'root', name: 'Other bookmarks' },
    { id: 'c', name: 'C' },
    { id: 'c1', name: 'C1' },
  ])
})

it('a real top-level folder named "Other bookmarks" is not doubled by the virtual section', () => {
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [folder('Other bookmarks', 'ob', [folder('X', 'x')])] }
  expect(crumbPath(root, 'ob')).toEqual([{ id: 'ob', name: 'Other bookmarks' }])
  expect(crumbPath(root, 'x')).toEqual([
    { id: 'ob', name: 'Other bookmarks' },
    { id: 'x', name: 'X' },
  ])
})

it('a document without a toolbar folder wraps everything in "Other bookmarks"', () => {
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [folder('Favs', 'favs', [folder('Mail', 'mail')])] }
  expect(crumbPath(root, 'favs')).toEqual([
    { id: 'root', name: 'Other bookmarks' },
    { id: 'favs', name: 'Favs' },
  ])
  expect(crumbPath(root, 'mail')).toEqual([
    { id: 'root', name: 'Other bookmarks' },
    { id: 'favs', name: 'Favs' },
    { id: 'mail', name: 'Mail' },
  ])
})

it('mobile bookmarks folders keep the real path, not the virtual "Other bookmarks" section', () => {
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [folder('Mobile bookmarks', 'mob', [folder('Ph', 'ph')])] }
  expect(crumbPath(root, 'mob')).toEqual([{ id: 'mob', name: 'Mobile bookmarks' }])
  expect(crumbPath(root, 'ph')).toEqual([
    { id: 'mob', name: 'Mobile bookmarks' },
    { id: 'ph', name: 'Ph' },
  ])
})