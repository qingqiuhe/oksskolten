import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFeedSelection } from './use-feed-selection'

describe('useFeedSelection', () => {
  it('toggles individual feeds with meta key', () => {
    const { result } = renderHook(() => useFeedSelection({ orderedFeedIds: [1, 2, 3, 4] }))

    act(() => result.current.toggleSelect(2, true, false))
    act(() => result.current.toggleSelect(4, true, false))

    expect([...result.current.selectedFeedIds]).toEqual([2, 4])
    expect(result.current.selectedCount).toBe(2)
    expect(result.current.isSelected(2)).toBe(true)
    expect(result.current.isSelected(3)).toBe(false)

    act(() => result.current.toggleSelect(2, true, false))

    expect([...result.current.selectedFeedIds]).toEqual([4])
    expect(result.current.selectedCount).toBe(1)
  })

  it('selects a contiguous range with shift key', () => {
    const { result } = renderHook(() => useFeedSelection({ orderedFeedIds: [10, 20, 30, 40, 50] }))

    act(() => result.current.toggleSelect(20, false, false))
    act(() => result.current.toggleSelect(50, false, true))

    expect([...result.current.selectedFeedIds]).toEqual([20, 30, 40, 50])
    expect(result.current.selectionGroupPos(20)).toEqual({ isFirst: true, isLast: false })
    expect(result.current.selectionGroupPos(30)).toEqual({ isFirst: false, isLast: false })
    expect(result.current.selectionGroupPos(50)).toEqual({ isFirst: false, isLast: true })
  })

  it('ignores invalid shift ranges and can clear selection', () => {
    const { result } = renderHook(() => useFeedSelection({ orderedFeedIds: [1, 2, 3] }))

    act(() => result.current.toggleSelect(2, true, false))
    act(() => result.current.toggleSelect(99, false, true))

    expect([...result.current.selectedFeedIds]).toEqual([2])

    act(() => result.current.clearSelection())

    expect(result.current.selectedCount).toBe(0)
    expect([...result.current.selectedFeedIds]).toEqual([])
  })
})
