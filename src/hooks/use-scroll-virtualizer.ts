import { useState, useEffect, useCallback } from 'react'

export interface VirtualWindowOptions {
  totalCount: number
  estimateItemHeight?: number
  overscan?: number
  containerRef?: React.RefObject<HTMLElement | null>
  enabled?: boolean
}

export interface VirtualWindowResult {
  startIndex: number
  endIndex: number
  topSpacerHeight: number
  bottomSpacerHeight: number
  isVirtualizing: boolean
}

const MIN_VIRTUALIZE_COUNT = 40

export function useScrollVirtualizer({
  totalCount,
  estimateItemHeight = 90,
  overscan = 20,
  containerRef,
  enabled = true,
}: VirtualWindowOptions): VirtualWindowResult {
  const shouldVirtualize = enabled && totalCount > MIN_VIRTUALIZE_COUNT

  const [range, setRange] = useState<{ startIndex: number; endIndex: number }>({
    startIndex: 0,
    endIndex: totalCount,
  })

  const updateRange = useCallback(() => {
    if (!shouldVirtualize || typeof window === 'undefined') {
      setRange({ startIndex: 0, endIndex: totalCount })
      return
    }

    const viewportHeight = window.innerHeight || 800
    const scrollY = window.scrollY || window.pageYOffset || 0
    let containerOffsetTop = 0

    if (containerRef?.current) {
      const rect = containerRef.current.getBoundingClientRect()
      containerOffsetTop = Math.max(0, rect.top + scrollY)
    }

    const relativeScroll = Math.max(0, scrollY - containerOffsetTop)
    const rawStart = Math.floor(relativeScroll / estimateItemHeight)
    const rawEnd = Math.ceil((relativeScroll + viewportHeight) / estimateItemHeight)

    const startIndex = Math.max(0, rawStart - overscan)
    const endIndex = Math.min(totalCount, rawEnd + overscan)

    setRange(prev => {
      if (prev.startIndex === startIndex && prev.endIndex === endIndex) return prev
      return { startIndex, endIndex }
    })
  }, [totalCount, estimateItemHeight, overscan, containerRef, shouldVirtualize])

  useEffect(() => {
    updateRange()
    if (!shouldVirtualize || typeof window === 'undefined') return

    let rafId: number | null = null
    const onScrollOrResize = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        updateRange()
        rafId = null
      })
    }

    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize, { passive: true })

    return () => {
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      if (rafId !== null) window.cancelAnimationFrame(rafId)
    }
  }, [updateRange, shouldVirtualize])

  const topSpacerHeight = shouldVirtualize ? range.startIndex * estimateItemHeight : 0
  const bottomSpacerHeight = shouldVirtualize ? Math.max(0, totalCount - range.endIndex) * estimateItemHeight : 0

  return {
    startIndex: shouldVirtualize ? range.startIndex : 0,
    endIndex: shouldVirtualize ? range.endIndex : totalCount,
    topSpacerHeight,
    bottomSpacerHeight,
    isVirtualizing: shouldVirtualize,
  }
}
