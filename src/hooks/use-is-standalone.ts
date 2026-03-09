import { useState, useEffect } from 'react'

export function useIsStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === 'undefined') return false
    // iOS Safari
    if ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone) return true
    // Standard
    return window.matchMedia('(display-mode: standalone)').matches
  })

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)')
    const handler = (e: MediaQueryListEvent) => setIsStandalone(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isStandalone
}
