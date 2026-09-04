export type NodeType = 'folder' | 'link'

export interface BmNode {
  id: string
  type: NodeType
  name: string
  url?: string
  addDate?: number
  lastMod?: number
  /** extra preserved attributes from source (ICON is intentionally dropped) */
  attrs?: Record<string, string>
  /** folder children */
  children: BmNode[]
  /** marked dead by the link checker */
  dead?: boolean
}

export const ROOT_ID = '__root__'

export type DocView = 'home' | 'manager' | 'dupes' | 'dead' | 'search'

export interface BookmarkDoc {
  id: string
  fileName: string
  title: string
  importedAt: number
  root: BmNode
  /** UI state scoped to this document (persisted) */
  view: DocView
  currentFolderId: string
  collapsed: Record<string, boolean>
  selected: string[]
  /** multi-selected folder rows in the tree sidebar (drag sets) */
  treeSel: string[]
  searchQuery: string
  /** increment on every "show in tree" reveal; drives scroll/flash feedback */
  revealRev: number
  /** timestamp of the most recent reveal, used to detect a fresh reveal on remount */
  lastRevealAt: number
  /** link-checker collected dead links live in a dedicated folder */
  deadFolderCreated?: boolean
  /** content changed since the last export (or import); closing such a tab warns */
  dirty?: boolean
  /** never persisted to IndexedDB (the live Chrome doc) — always re-read from the source */
  ephemeral?: boolean
}

export interface WorkspaceMeta {
  tabs: string[]
  activeDocId: string | null
}

export interface Stats {
  links: number
  folders: number
  uniqueUrls: number
  duplicateGroups: number
  deadLinks: number
}

export interface ToolbarItem {
  id: string
  type: NodeType
  name: string
  url?: string
  children?: BmNode[]
}