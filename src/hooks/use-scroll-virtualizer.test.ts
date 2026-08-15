import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScrollVirtualizer } from './use-scroll-virtualizer'

describe('useScrollVirtualizer', () => {
  const originalInnerHeight = window.innerHeight
  const originalScrollY = window.scrollY

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 })
    Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: 0 })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalInnerHeight })
    Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: originalScrollY })
    vi.restoreAllMocks()
  })

  it('does not virtualize small lists (<= 40 items)', () => {
    const { result } = renderHook(() => useScrollVirtualizer({ totalCount: 30 }))
    expect(result.current.isVirtualizing).toBe(false)
    expect(result.current.startIndex).toBe(0)
    expect(result.current.endIndex).toBe(30)
    expect(result.current.topSpacerHeight).toBe(0)
    expect(result.current.bottomSpacerHeight).toBe(0)
  })

  it('virtualizes 100 loaded articles maintaining bounded DOM window', () => {
    const { result } = renderHook(() =>
      useScrollVirtualizer({ totalCount: 100, estimateItemHeight: 100, overscan: 10 }),
    )
    expect(result.current.isVirtualizing).toBe(true)
    expect(result.current.startIndex).toBe(0)
    // At scroll=0, viewport=800, height=100 -> rawEnd=8, end=8+10=18
    expect(result.current.endIndex).toBe(18)
    expect(result.current.topSpacerHeight).toBe(0)
    expect(result.current.bottomSpacerHeight).toBe((100 - 18) * 100)
  })

  it('adjusts window upon scrolling in 300 and 500 loaded articles', () => {
    const { result } = renderHook(() =>
      useScrollVirtualizer({ totalCount: 500, estimateItemHeight: 100, overscan: 10 }),
    )

    // Scroll to item 200 (scrollY = 20,000)
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 20000 })
      window.dispatchEvent(new Event('scroll'))
    })

    // rawStart = 200, rawEnd = 208
    // startIndex = 200 - 10 = 190, endIndex = 208 + 10 = 218
    expect(result.current.startIndex).toBe(190)
    expect(result.current.endIndex).toBe(218)
    expect(result.current.topSpacerHeight).toBe(190 * 100)
    expect(result.current.bottomSpacerHeight).toBe((500 - 218) * 100)
    // Mounted row count is only 28 rows instead of 500
    const mountedCount = result.current.endIndex - result.current.startIndex
    expect(mountedCount).toBe(28)
  })
})
