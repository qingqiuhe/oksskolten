import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import type { ArticleListItem } from '../../../shared/types'
import { SocialCard } from './social-card'

function makeArticle(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 1,
    feed_id: 1,
    feed_name: 'Example Author',
    feed_icon_url: 'https://cdn.example.com/avatar.png',
    feed_view_type: 'social',
    title: 'Example tweet',
    url: 'https://x.com/example/status/123',
    article_kind: 'quote',
    published_at: '2026-03-30T00:00:00.000Z',
    lang: 'en',
    summary: null,
    excerpt: 'A social post body',
    og_image: 'https://cdn.example.com/media.png',
    has_video: false,
    seen_at: null,
    read_at: null,
    bookmarked_at: null,
    liked_at: null,
    ...overrides,
  }
}

describe('SocialCard', () => {
  it('renders tweet-style metadata and media', () => {
    const { getByText, container } = render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
          <SocialCard article={makeArticle()} dateMode="absolute" />
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(getByText('Example Author')).toBeTruthy()
    expect(getByText('@example')).toBeTruthy()
    expect(getByText('A social post body')).toBeTruthy()
    expect(getByText('Quote')).toBeTruthy()
    expect(container.querySelector('img[src="https://cdn.example.com/media.png"]')).not.toBeNull()
  })
})
