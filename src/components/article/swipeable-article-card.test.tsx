import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { LocaleContext } from '../../lib/i18n'
import { SwipeableArticleCard, resolveSwipeAction } from './swipeable-article-card'
import type { ArticleListItem } from '../../../shared/types'

const navigateMock = vi.fn()
let dragProps: Record<string, unknown> | null = null

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, drag, ...props }: Record<string, unknown>) => {
      if (drag === 'x') dragProps = props
      return <div {...props}>{children as ReactNode}</div>
    },
  },
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
  useTransform: (_value: unknown, transform: (latest: number) => number) => transform(0),
}))

vi.mock('./article-card', () => ({
  ArticleCard: ({ article }: { article: ArticleListItem }) => <div>{article.title}</div>,
}))

function makeArticle(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 1,
    feed_id: 1,
    feed_name: 'Example Feed',
    feed_view_type: 'article',
    article_kind: null,
    title: 'Example Article',
    url: 'https://example.com/posts/1',
    published_at: '2026-03-30T00:00:00.000Z',
    lang: 'en',
    summary: null,
    excerpt: 'Example excerpt',
    og_image: null,
    has_video: false,
    seen_at: null,
    read_at: null,
    bookmarked_at: null,
    liked_at: null,
    ...overrides,
  }
}

describe('resolveSwipeAction', () => {
  it('maps swipe distances to expected actions', () => {
    expect(resolveSwipeAction(-81, 0)).toBe('open')
    expect(resolveSwipeAction(81, 0)).toBe('seen')
    expect(resolveSwipeAction(161, 0)).toBe('bookmark')
    expect(resolveSwipeAction(10, 0)).toBeNull()
  })
})

describe('SwipeableArticleCard', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    dragProps = null
  })

  it('renders background icons for left, seen, and bookmark swipe states', () => {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
          <SwipeableArticleCard
            article={makeArticle()}
            dateMode="relative"
            indicatorStyle="dot"
            showUnreadIndicator
            showThumbnails={false}
          />
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.getByText('Example Article')).toBeTruthy()
    expect(document.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3)
  })

  it('calls the supplied callback for a short right swipe', () => {
    const onSwipeMarkSeen = vi.fn()

    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
          <SwipeableArticleCard
            article={makeArticle()}
            dateMode="relative"
            indicatorStyle="dot"
            showUnreadIndicator
            showThumbnails={false}
            onSwipeMarkSeen={onSwipeMarkSeen}
          />
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(dragProps).not.toBeNull()
    ;(dragProps?.onDragStart as (() => void) | undefined)?.()
    ;(dragProps?.onDragEnd as ((_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => void) | undefined)?.(
      {},
      { offset: { x: 100 }, velocity: { x: 0 } },
    )

    expect(onSwipeMarkSeen).toHaveBeenCalledTimes(1)
    expect(onSwipeMarkSeen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('calls the supplied callback for a long right swipe', () => {
    const onSwipeBookmark = vi.fn()

    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
          <SwipeableArticleCard
            article={makeArticle()}
            dateMode="relative"
            indicatorStyle="dot"
            showUnreadIndicator
            showThumbnails={false}
            onSwipeBookmark={onSwipeBookmark}
          />
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(dragProps).not.toBeNull()
    ;(dragProps?.onDragStart as (() => void) | undefined)?.()
    ;(dragProps?.onDragEnd as ((_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => void) | undefined)?.(
      {},
      { offset: { x: 180 }, velocity: { x: 0 } },
    )

    expect(onSwipeBookmark).toHaveBeenCalledTimes(1)
    expect(onSwipeBookmark).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('opens the article on a left swipe', () => {
    const onSwipeOpen = vi.fn()

    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
          <SwipeableArticleCard
            article={makeArticle()}
            dateMode="relative"
            indicatorStyle="dot"
            showUnreadIndicator
            showThumbnails={false}
            onSwipeOpen={onSwipeOpen}
          />
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(dragProps).not.toBeNull()
    ;(dragProps?.onDragStart as (() => void) | undefined)?.()
    ;(dragProps?.onDragEnd as ((_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => void) | undefined)?.(
      {},
      { offset: { x: -100 }, velocity: { x: 0 } },
    )

    expect(onSwipeOpen).toHaveBeenCalledTimes(1)
    expect(onSwipeOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
