import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InboxSelectionBar } from './inbox-selection-bar'

describe('InboxSelectionBar', () => {
  it('renders selection count and action buttons', () => {
    const onSelectAllVisible = vi.fn()
    const onDeselectAll = vi.fn()
    const onBatchMarkSeen = vi.fn()
    const onBatchBookmark = vi.fn()
    const onCancel = vi.fn()

    render(
      <InboxSelectionBar
        selectedCount={3}
        totalVisibleCount={10}
        onSelectAllVisible={onSelectAllVisible}
        onDeselectAll={onDeselectAll}
        onBatchMarkSeen={onBatchMarkSeen}
        onBatchBookmark={onBatchBookmark}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('3 selected')).toBeTruthy()

    // Click select visible
    fireEvent.click(screen.getByRole('button', { name: 'Select visible' }))
    expect(onSelectAllVisible).toHaveBeenCalled()

    // Click mark read
    fireEvent.click(screen.getByTitle('Mark selected as read'))
    expect(onBatchMarkSeen).toHaveBeenCalled()

    // Click bookmark
    fireEvent.click(screen.getByTitle('Bookmark selected'))
    expect(onBatchBookmark).toHaveBeenCalled()

    // Click cancel
    fireEvent.click(screen.getByLabelText('Cancel selection'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables action buttons when selectedCount is 0', () => {
    render(
      <InboxSelectionBar
        selectedCount={0}
        totalVisibleCount={10}
        onSelectAllVisible={vi.fn()}
        onDeselectAll={vi.fn()}
        onBatchMarkSeen={vi.fn()}
        onBatchBookmark={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const markReadBtn = screen.getByTitle('Mark selected as read') as HTMLButtonElement
    const bookmarkBtn = screen.getByTitle('Bookmark selected') as HTMLButtonElement
    expect(markReadBtn.disabled).toBe(true)
    expect(bookmarkBtn.disabled).toBe(true)
  })
})
