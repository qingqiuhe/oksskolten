import { useState, useCallback, useRef } from 'react'

interface UseFeedSelectionOpts {
  orderedFeedIds: number[]
}

export function useFeedSelection({ orderedFeedIds }: UseFeedSelectionOpts) {
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<number>>(new Set())
  const lastSelectedRef = useRef<number | null>(null)

  const toggleSelect = useCallback(
    (feedId: number, metaKey: boolean, shiftKey: boolean) => {
      setSelectedFeedIds(prev => {
        if (shiftKey && lastSelectedRef.current !== null) {
          // Range selection
          const fromIdx = orderedFeedIds.indexOf(lastSelectedRef.current)
          const toIdx = orderedFeedIds.indexOf(feedId)
          if (fromIdx === -1 || toIdx === -1) return prev
          const start = Math.min(fromIdx, toIdx)
          const end = Math.max(fromIdx, toIdx)
          const next = new Set(prev)
          for (let i = start; i <= end; i++) {
            next.add(orderedFeedIds[i])
          }
          return next
        }
        if (metaKey) {
          // Toggle single
          const next = new Set(prev)
          if (next.has(feedId)) {
            next.delete(feedId)
          } else {
            next.add(feedId)
          }
          lastSelectedRef.current = feedId
          return next
        }
        // Plain click with no modifier — handled by caller (navigate)
        // This shouldn't normally be called without a modifier, but just in case:
        lastSelectedRef.current = feedId
        return new Set([feedId])
      })
      if (!shiftKey) {
        lastSelectedRef.current = feedId
      }
    },
    [orderedFeedIds],
  )

  const clearSelection = useCallback(() => {
    setSelectedFeedIds(new Set())
    lastSelectedRef.current = null
  }, [])

  const isSelected = useCallback(
    (feedId: number) => selectedFeedIds.has(feedId),
    [selectedFeedIds],
  )

  return {
    selectedFeedIds,
    selectedCount: selectedFeedIds.size,
    toggleSelect,
    clearSelection,
    isSelected,
  }
}
