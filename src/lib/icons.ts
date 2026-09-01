import {
  AlertTriangle, ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Check, ChevronDown, ChevronRight, Clipboard,
  ClipboardPaste, Copy, CopyPlus, Dot, Download, Edit3, Ellipsis, ExternalLink, Eye, EyeOff, FilePlus2, Files, Folder, FolderClosed,
  FolderOpen, FolderPlus, Frown, Globe, Grid2x2, Home, Inbox, Info, Layers, Link2, List, ListTree, Loader2,
  Menu, Moon, MoreHorizontal, MousePointer2, Network, PanelLeft, Pencil, Plus, RefreshCw, RotateCcw,
  RotateCw, Scissors, Search, Settings2, Skull, Star, Sun, Trash2, Type, Undo2, Upload, X,
} from '@lucide/vue'
import type { Component } from 'vue'

export const ICONS: Record<string, Component> = {
  AlertTriangle, ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Check, ChevronDown, ChevronRight, Clipboard,
  ClipboardPaste, Copy, CopyPlus, Dot, Download, Edit3, Ellipsis, ExternalLink, Eye, EyeOff, FilePlus2, Files, Folder, FolderClosed,
  FolderOpen, FolderPlus, Frown, Globe, Grid2x2, Home, Inbox, Info, Layers, Link2, List, ListTree, Loader2,
  Menu, Moon, MoreHorizontal, MousePointer2, Network, PanelLeft, Pencil, Plus, RefreshCw, RotateCcw,
  RotateCw, Scissors, Search, Settings2, Skull, Star, Sun, Trash2, Type, Undo2, Upload, X,
}

export function useIcon(name: string): Component {
  return ICONS[name] ?? ICONS.Dot
}
