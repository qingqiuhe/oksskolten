import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUndoSeen } from './use-undo-seen'

describe('useUndoSeen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-06T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enqueues items in reverse chronological order and trims overflow', () => {
    const { result } = renderHook(() => useUndoSeen({ maxItems: 2, windowMs: 10_000 }))

    act(() => {
      result.current.enqueueUndoSeen({ articleId: 1, undo: vi.fn() })
      result.current.enqueueUndoSeen({ articleId: 2, undo: vi.fn() })
      result.current.enqueueUndoSeen({ articleId: 3, undo: vi.fn() })
    })

    expect(result.current.items.map(item => item.articleId)).toEqual([3, 2])
    expect(result.current.items.every(item => item.expiresAt === Date.now() + 10_000)).toBe(true)
  })

  it('undoes an item once and returns false for missing items', async () => {
    const undo = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useUndoSeen({ windowMs: 10_000 }))

    let id = 0
    act(() => {
      id = result.current.enqueueUndoSeen({ articleId: 42, undo })
    })

    await act(async () => {
      await expect(result.current.undoSeen(id)).resolves.toBe(true)
    })

    await act(async () => {
      await expect(result.current.undoSeen(id)).resolves.toBe(false)
    })

    expect(undo).toHaveBeenCalledTimes(1)
    expect(result.current.items).toEqual([])
  })

  it('dismisses and auto-expires queued items', () => {
    const { result } = renderHook(() => useUndoSeen({ windowMs: 5_000 }))

    let keptId = 0
    let dismissedId = 0
    act(() => {
      keptId = result.current.enqueueUndoSeen({ articleId: 1, undo: vi.fn() })
      dismissedId = result.current.enqueueUndoSeen({ articleId: 2, undo: vi.fn() })
    })

    act(() => {
      result.current.dismissUndoSeen(dismissedId)
    })

    expect(result.current.items.map(item => item.id)).toEqual([keptId])

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(result.current.items).toEqual([])
  })

  it('clears all pending items and timers', () => {
    const { result } = renderHook(() => useUndoSeen({ windowMs: 5_000 }))

    act(() => {
      result.current.enqueueUndoSeen({ articleId: 1, undo: vi.fn() })
      result.current.enqueueUndoSeen({ articleId: 2, undo: vi.fn() })
      result.current.clearUndoSeen()
      vi.advanceTimersByTime(5_000)
    })

    expect(result.current.items).toEqual([])
  })
})
