import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SimilarGroupView } from './similar-group'
import type { SimilarGroup } from '../../../shared/types'

describe('SimilarGroupView', () => {
  const mockGroup: SimilarGroup = {
    count: 3,
    articles: [
      {
        id: 2,
        feed_id: 10,
        feed_name: 'TechCrunch',
        title: 'Similar coverage from TechCrunch',
        url: 'https://techcrunch.com/article-2',
        published_at: '2026-01-01T00:00:00.000Z',
        seen_at: null,
        read_at: null,
        bookmarked_at: null,
        liked_at: null,
      },
      {
        id: 3,
        feed_id: 11,
        feed_name: 'The Verge',
        title: 'Similar coverage from The Verge',
        url: 'https://theverge.com/article-3',
        published_at: '2026-01-01T01:00:00.000Z',
        seen_at: '2026-01-01T02:00:00.000Z',
        read_at: null,
        bookmarked_at: null,
        liked_at: null,
      },
    ],
  }

  it('renders collapsed toggle button initially and expands on click', () => {
    render(
      <MemoryRouter>
        <SimilarGroupView group={mockGroup} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: /Show 2 similar stories/i })).toBeTruthy()
    expect(screen.queryByText('Similar coverage from TechCrunch')).toBeNull()

    // Expand
    fireEvent.click(screen.getByRole('button', { name: /Show 2 similar stories/i }))

    expect(screen.getByText('Similar coverage from TechCrunch')).toBeTruthy()
    expect(screen.getByText('Similar coverage from The Verge')).toBeTruthy()
  })

  it('returns null if group has only 1 or 0 items', () => {
    const singleGroup: SimilarGroup = { count: 1, articles: [] }
    const { container } = render(
      <MemoryRouter>
        <SimilarGroupView group={singleGroup} />
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })
})
