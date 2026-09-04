// In-memory chrome.bookmarks test double. Every operation reproduces the
// semantics observed by the spike against a real Chrome for Testing 151
// profile (spike/spike-results.json):
//   - create: index ∈ [0, count], beyond throws 'Index out of bounds.'
//   - move: pre-removal index counting — same-parent with srcPos < requested
//     lands at requested − 1; srcPos ≥ requested lands at requested;
//     requested == count lands at the end; beyond throws.
//     cross-parent: index ∈ [0, destCount], lands exactly; omitted appends.
//   - remove on a non-empty folder throws; removeTree always succeeds
//   - moving a folder into itself or a descendant throws
// Ids are numeric strings from a monotonic counter, like chrome's. Events
// fire synchronously so tests can drive watcher logic.
import type { ChromeBackend, ChromePlain } from './chrome'

interface Internal {
  id: string
  title: string
  url?: string
  dateAdded: number
  /** folders only — links have no children property, mirroring chrome.bookmarks */
  children?: Internal[]
}

type Listener = () => void

export class FakeChrome implements ChromeBackend {
  private root: Internal
  private counter = 100
  private listeners = new Set<Listener>()
  private parentOf = new Map<string, string>()

  constructor(seed?: (root: Internal) => void) {
    this.root = {
      id: '0',
      title: '',
      dateAdded: 0,
      children: [
        { id: '1', title: 'Bookmarks bar', dateAdded: 0, children: [] },
        { id: '2', title: 'Other bookmarks', dateAdded: 0, children: [] },
      ],
    }
    seed?.(this.root)
    this.reindex()
  }

  // ---- test helpers --------------------------------------------------------
  watch(cb: Listener): void {
    this.listeners.add(cb)
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }
  byId(id: string): Internal | undefined {
    return this.find(this.root, id)
  }
  parent(id: string): Internal {
    const pid = this.parentOf.get(id)
    const p = pid ? this.byId(pid) : undefined
    if (!p) throw new Error(`no parent for ${id}`)
    return p
  }
  private find(n: Internal, id: string): Internal | undefined {
    if (n.id === id) return n
    for (const c of n.children ?? []) {
      const r = this.find(c, id)
      if (r) return r
    }
    return undefined
  }
  private reindex(): void {
    this.parentOf.clear()
    const visit = (n: Internal): void => {
      for (const c of n.children ?? []) {
        this.parentOf.set(c.id, n.id)
        visit(c)
      }
    }
    visit(this.root)
  }

  // ---- ChromeBackend -------------------------------------------------------
  async getTree(): Promise<ChromePlain> {
    return this.toPlain(this.root)
  }
  private toPlain(n: Internal): ChromePlain {
    return {
      id: n.id,
      title: n.title,
      ...(n.url !== undefined ? { url: n.url } : {}),
      ...(n.children ? { children: n.children.map((c) => this.toPlain(c)) } : {}),
    }
  }

  async create(p: { parentId: string; title: string; url?: string; index?: number }): Promise<{ id: string }> {
    const parent = this.byId(p.parentId)
    if (!parent || !parent.children) throw new Error(`Can't find parent folder.`)
    const index = p.index ?? parent.children.length
    if (index < 0 || index > parent.children.length) throw new Error('Index out of bounds.')
    const node: Internal =
      p.url === undefined
        ? { id: String(this.counter++), title: p.title, dateAdded: Date.now(), children: [] }
        : { id: String(this.counter++), title: p.title, url: p.url, dateAdded: Date.now() }
    parent.children.splice(index, 0, node)
    this.reindex()
    this.emit()
    return { id: node.id }
  }

  async update(id: string, p: { title?: string; url?: string }): Promise<void> {
    const n = this.byId(id)
    if (!n) throw new Error(`Can't find bookmark for id.`)
    if (p.title !== undefined) n.title = p.title
    if (p.url !== undefined) n.url = p.url
    this.emit()
  }

  async remove(id: string): Promise<void> {
    const n = this.byId(id)
    if (!n) throw new Error(`Can't find bookmark for id.`)
    if (n.children && n.children.length) throw new Error(`Can't remove non-empty folder (use recursive to force).`)
    detach(this.parent(id), id)
    this.reindex()
    this.emit()
  }

  async removeTree(id: string): Promise<void> {
    if (!this.byId(id)) throw new Error(`Can't find bookmark for id.`)
    detach(this.parent(id), id)
    this.reindex()
    this.emit()
  }

  async move(id: string, p: { parentId: string; index?: number }): Promise<void> {
    const n = this.byId(id)
    if (!n) throw new Error(`Can't find bookmark for id.`)
    const dest = this.byId(p.parentId)
    if (!dest || !dest.children) throw new Error(`Can't find destination folder.`)
    // destination inside the node's own subtree?
    for (let anc: string | undefined = dest.id; anc; anc = this.parentOf.get(anc)) {
      if (anc === id) throw new Error(`Can't move a folder to itself or its descendant.`)
    }
    const src = this.parent(id)
    if (src.id === dest.id) {
      const from = src.children!.findIndex((c) => c.id === id)
      if (p.index === undefined) {
        src.children!.splice(from, 1)
        src.children!.push(n)
      } else {
        const requested = p.index
        if (requested < 0 || requested > src.children!.length) throw new Error('Index out of bounds.')
        const final = requested - (from < requested ? 1 : 0)
        src.children!.splice(from, 1)
        src.children!.splice(final, 0, n)
      }
    } else {
      const requested = p.index ?? dest.children!.length
      if (requested < 0 || requested > dest.children!.length) throw new Error('Index out of bounds.')
      detach(src, id)
      dest.children!.splice(requested, 0, n)
      this.reindex()
    }
    this.emit()
  }
}

function detach(parent: Internal, id: string): void {
  const i = parent.children!.findIndex((c) => c.id === id)
  if (i >= 0) parent.children!.splice(i, 1)
}
