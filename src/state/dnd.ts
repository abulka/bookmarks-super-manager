import { defineStore } from 'pinia'

export interface DragSession {
  docId: string
  nodeIds: string[]
  sourceParentId: string
  /** kinds of dragged items, for messaging */
  isFolder: boolean
}

export type DropMode = 'before' | 'after' | 'inside'

export interface DropTarget {
  /** id of the folder receiving the drop */
  folderId: string
  /** node used as the anchor between which insertion happens (child of folderId) */
  anchorId: string | null
  mode: DropMode
  /** parent folder of the anchor row (needed for before/after drops) */
  parentId?: string
}

export const useDnd = defineStore('dnd', {
  state: () => ({
    session: null as DragSession | null,
    target: null as DropTarget | null,
    /** expanded on hover during drag for auto-open */
    autoOpenId: null as string | null,
  }),
  actions: {
    start(s: DragSession) {
      this.session = s
    },
    setTarget(t: DropTarget | null) {
      this.target = t
    },
    setAutoOpen(id: string | null) {
      this.autoOpenId = id
    },
    end() {
      this.session = null
      this.target = null
      this.autoOpenId = null
    },
  },
})