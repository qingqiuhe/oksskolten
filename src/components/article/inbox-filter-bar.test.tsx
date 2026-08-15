import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InboxFilterBar, DEFAULT_INBOX_FILTERS, type InboxFilters } from './inbox-filter-bar'

describe('InboxFilterBar', () => {
  const feeds = [
    { id: 1, name: 'Feed 1' },
    { id: 2, name: 'Feed 2' },
  ]

  it('renders collapsed by default and expands on click', () => {
    const onChange = vi.fn()
    render(<InboxFilterBar feeds={feeds} filters={DEFAULT_INBOX_FILTERS} onChange={onChange} />)

    expect(screen.getByRole('button', { name: /Filters/i })).toBeTruthy()
    expect(screen.queryByText('Time Range')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Filters/i }))

    expect(screen.getByText('Time Range')).toBeTruthy()
    expect(screen.getByText('Feed 1')).toBeTruthy()
    expect(screen.getByText('Feed 2')).toBeTruthy()
  })

  it('triggers filter updates when selecting presets and feeds', () => {
    const onChange = vi.fn()
    render(<InboxFilterBar feeds={feeds} filters={DEFAULT_INBOX_FILTERS} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Filters/i }))

    // Click 'Today'
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_INBOX_FILTERS, timeRange: 'today' })

    // Click 'Feed 1'
    fireEvent.click(screen.getByRole('button', { name: 'Feed 1' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_INBOX_FILTERS, feedIds: [1] })
  })

  it('supports resetting filters', () => {
    const onChange = vi.fn()
    const activeFilters: InboxFilters = {
      feedIds: [1],
      timeRange: 'today',
      includeBookmarked: true,
      includeLiked: false,
    }
    render(<InboxFilterBar feeds={feeds} filters={activeFilters} onChange={onChange} />)

    const resetButton = screen.getByRole('button', { name: /Reset/i })
    expect(resetButton).toBeTruthy()

    fireEvent.click(resetButton)
    expect(onChange).toHaveBeenCalledWith(DEFAULT_INBOX_FILTERS)
  })
})
