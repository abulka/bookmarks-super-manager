export interface Undoable {
  label: string
  redo: () => void
  undo: () => void
}

const MAX_STEPS = 200

export class UndoStack {
  private undoStack: Undoable[] = []
  private redoStack: Undoable[] = []
  private groupDepth = 0
  private groupBuffer: Undoable[] | null = null

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get undoLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? ''
  }
  get redoLabel(): string {
    return this.redoStack[this.redoStack.length - 1]?.label ?? ''
  }

  push(entry: Undoable): void {
    if (this.groupDepth > 0 && this.groupBuffer) {
      this.groupBuffer.push(entry)
    } else {
      this.commit(entry)
    }
  }

  /** Run `fn`; all pushes inside are grouped into one undo step. */
  group(label: string, fn: () => void): void {
    this.groupDepth++
    if (!this.groupBuffer) this.groupBuffer = []
    try {
      fn()
    } finally {
      this.groupDepth--
      if (this.groupDepth === 0 && this.groupBuffer) {
        const buf = this.groupBuffer
        this.groupBuffer = null
        if (buf.length === 1) this.commit(buf[0])
        else if (buf.length > 1) this.commit({ label, undo: () => { for (let i = buf.length - 1; i >= 0; i--) buf[i].undo() }, redo: () => buf.forEach((b) => b.redo()) })
      }
    }
  }

  private commit(entry: Undoable): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift()
    this.redoStack.length = 0
  }

  undo(): void {
    const e = this.undoStack.pop()
    if (!e) return
    e.undo()
    this.redoStack.push(e)
  }

  redo(): void {
    const e = this.redoStack.pop()
    if (!e) return
    e.redo()
    this.undoStack.push(e)
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }
}