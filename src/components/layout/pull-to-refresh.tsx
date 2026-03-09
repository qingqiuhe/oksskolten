import { useState, useRef, useCallback, useEffect } from 'react'
import { ArrowDown } from 'lucide-react'

interface PullToRefreshProps {
  onRefresh: () => void | Promise<unknown>
}

const PULL_THRESHOLD = 80
const MAX_PULL = 120

export function PullToRefresh({ onRefresh }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const pulling = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Only enable if scrolled to top
    if (window.scrollY > 0) return
    startY.current = e.touches[0].clientY
    pulling.current = true
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current || refreshing) return
    const dy = e.touches[0].clientY - startY.current
    if (dy < 0) {
      setPullDistance(0)
      return
    }
    // Dampen the pull distance
    const dampened = Math.min(dy * 0.5, MAX_PULL)
    setPullDistance(dampened)
  }, [refreshing])

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return
    pulling.current = false

    if (pullDistance >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true)
      setPullDistance(PULL_THRESHOLD * 0.5) // Keep a small indicator visible
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        setPullDistance(0)
      }
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, refreshing, onRefresh])

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('touchend', handleTouchEnd)
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  if (pullDistance === 0 && !refreshing) return null

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1)
  const rotation = progress * 180

  return (
    <div
      className="flex items-center justify-center overflow-hidden select-none"
      style={{ height: pullDistance }}
    >
      <div
        className="transition-transform"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        {refreshing ? (
          <div className="w-5 h-5 border-2 border-muted border-t-accent rounded-full animate-spin" />
        ) : (
          <ArrowDown className="w-5 h-5 text-muted" />
        )}
      </div>
    </div>
  )
}
