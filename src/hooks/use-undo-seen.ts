import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface UndoSeenItem {
  id: number
  articleId: number
  expiresAt: number
  undo: () => Promise<void> | void
}

export interface UseUndoSeenOptions {
  maxItems?: number
  windowMs?: number
}

export interface EnqueueUndoSeenInput {
  articleId: number
  undo: () => Promise<void> | void
}

const DEFAULT_MAX_ITEMS = 20
const DEFAULT_WINDOW_MS = 10_000

export function useUndoSeen(options?: UseUndoSeenOptions) {
  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS
  const [items, setItems] = useState<UndoSeenItem[]>([])
  const nextIdRef = useRef(1)
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const removeItem = useCallback((id: number) => {
    clearTimer(id)
    setItems(prev => prev.filter(item => item.id !== id))
  }, [clearTimer])

  const dismiss = useCallback((id: number) => {
    removeItem(id)
  }, [removeItem])

  const undo = useCallback(async (id: number) => {
    const item = items.find(entry => entry.id === id)
    if (!item) return false
    removeItem(id)
    await item.undo()
    return true
  }, [items, removeItem])

  const enqueue = useCallback(({ articleId, undo }: EnqueueUndoSeenInput) => {
    const id = nextIdRef.current++
    const expiresAt = Date.now() + windowMs
    const timer = setTimeout(() => {
      removeItem(id)
    }, windowMs)

    timersRef.current.set(id, timer)

    setItems(prev => {
      const next = [{ id, articleId, expiresAt, undo }, ...prev]
      const overflow = next.slice(maxItems)
      for (const entry of overflow) {
        clearTimer(entry.id)
      }
      return next.slice(0, maxItems)
    })

    return id
  }, [clearTimer, maxItems, removeItem, windowMs])

  const clearAll = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer)
    }
    timersRef.current.clear()
    setItems([])
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  return useMemo(() => ({
    items,
    enqueueUndoSeen: enqueue,
    undoSeen: undo,
    dismissUndoSeen: dismiss,
    clearUndoSeen: clearAll,
  }), [clearAll, dismiss, enqueue, items, undo])
}
