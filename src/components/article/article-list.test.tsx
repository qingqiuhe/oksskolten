import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { LocaleContext } from '../../lib/i18n'
import type { ArticleListItem } from '../../../shared/types'
import { toast } from 'sonner'

// --- Mocks ---
const { mockApiPost } = vi.hoisted(() => ({
  mockApiPost: vi.fn(() => Promise.resolve({ translated_titles: {} })),
}))

// Control useSWRInfinite return value per test
let swrInfiniteReturn: any = {
  data: undefined,
  error: undefined,
  size: 1,
  setSize: vi.fn(),
  isLoading: true,
  isValidating: false,
  mutate: vi.fn(),
}

// Control useSWR return value for /api/feeds
let swrFeedsData: any = undefined
let swrInboxSummaryData: any = undefined

vi.mock('swr/infinite', () => ({
  default: () => swrInfiniteReturn,
}))

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr')
  return {
    ...actual,
    default: (key: string) => {
      if (key === '/api/feeds') return { data: swrFeedsData }
      if (key === '/api/inbox/summary') return { data: swrInboxSummaryData, mutate: vi.fn() }
      return { data: undefined }
    },
    useSWRConfig: () => ({ mutate: vi.fn() }),
  }
})

vi.mock('../feed/feed-metrics-bar', () => ({
  FeedMetricsBar: ({ feed }: any) => <div data-testid="metrics-bar">{feed.name}</div>,
}))

vi.mock('../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: vi.fn(() => Promise.resolve()),
  apiPost: mockApiPost as any,
  apiDelete: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/markSeenWithQueue', () => ({
  markSeenOnServer: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/readTracker', () => ({
  trackRead: vi.fn(),
  isReadInSession: vi.fn(() => false),
}))

vi.mock('../../hooks/use-is-touch-device', () => ({
  useIsTouchDevice: vi.fn(() => false),
}))

vi.mock('../../hooks/use-clip-feed-id', () => ({
  useClipFeedId: vi.fn(() => null),
}))

vi.mock('../layout/pull-to-refresh', () => ({
  PullToRefresh: () => null,
}))

vi.mock('../../contexts/fetch-progress-context', () => ({
  useFetchProgressContext: () => ({
    progress: new Map(),
    startFeedFetch: vi.fn(() => Promise.resolve({ totalNew: 0 })),
    subscribeFeedFetch: vi.fn(),
  }),
}))

const noopSetFocusedItemId = () => {}
vi.mock('../../contexts/keyboard-navigation-context', () => ({
  useKeyboardNavigationContext: () => ({
    focusedItemId: null,
    setFocusedItemId: noopSetFocusedItemId,
  }),
}))

vi.mock('../ui/mascot', () => ({
  Mascot: () => <div data-testid="mascot" />,
}))

vi.mock('./swipeable-article-card', () => ({
  SwipeableArticleCard: ({ article, feedViewType }: { article: ArticleListItem; feedViewType?: string }) => (
    <div data-testid={`swipeable-${article.id}`} data-feed-view-type={feedViewType}>{article.title}</div>
  ),
}))

vi.mock('./article-card', () => ({
  ArticleCard: ({ article, feedViewType }: { article: ArticleListItem; feedViewType?: string }) => (
    <div data-testid={`article-${article.id}`} data-feed-view-type={feedViewType}>{article.title}</div>
  ),
}))

vi.mock('./article-overlay', () => ({
  ArticleOverlay: () => null,
}))

vi.mock('./article-detail', () => ({
  ArticleDetail: ({ articleUrl }: { articleUrl: string }) => (
    <div data-testid="article-detail-preview">{articleUrl}</div>
  ),
}))

vi.mock('../feed/feed-error-banner', () => ({
  FeedErrorBanner: () => null,
}))

vi.mock('../ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <div data-testid="skeleton" className={`animate-pulse ${className ?? ''}`} />,
}))

vi.mock('../chat/list-chat-fab', () => ({
  ListChatFab: ({
    listLabel,
    articleIds,
    renderTrigger,
  }: {
    listLabel: string
    articleIds: number[]
    renderTrigger?: (args: { open: boolean; toggle: () => void }) => ReactNode
  }) => (
    <>
      <div data-testid="list-chat-fab" data-list-label={listLabel} data-article-count={articleIds.length} />
      {renderTrigger?.({ open: false, toggle: vi.fn() })}
    </>
  ),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { ArticleList } from './article-list'

function makeArticle(overrides: Partial<ArticleListItem> = {}): ArticleListItem {
  return {
    id: 1,
    feed_id: 1,
    feed_name: 'Test Feed',
    feed_view_type: 'article',
    article_kind: null,
    title: 'Test Article',
    url: 'https://example.com/1',
    published_at: '2026-01-01T00:00:00Z',
    lang: 'en',
    summary: null,
    excerpt: 'Excerpt text',
    og_image: null,
    has_video: false,
    seen_at: null,
    read_at: null,
    bookmarked_at: null,
    liked_at: null,
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function getTopTranslateButton(label: string) {
  const buttons = screen.getAllByRole('button', { name: label })
  const button = buttons.find(el => !el.getAttribute('aria-label'))
  if (!button) {
    throw new Error(`Top translate button with label "${label}" not found`)
  }
  return button as HTMLButtonElement
}

const mockSettings = {
  colorMode: 'system' as const,
  setColorMode: vi.fn(),
  themeName: 'default',
  setTheme: vi.fn(),
  themes: [{ name: 'default', label: 'Default' }],
  dateMode: 'relative' as const,
  setDateMode: vi.fn(),
  autoMarkRead: 'off' as const,
  setAutoMarkRead: vi.fn(),
  showUnreadIndicator: 'on' as const,
  setShowUnreadIndicator: vi.fn(),
  indicatorStyle: 'dot' as const,
  internalLinks: 'on' as const,
  setInternalLinks: vi.fn(),
  showThumbnails: 'on' as const,
  setShowThumbnails: vi.fn(),
  showFeedActivity: 'on' as const,
  setShowFeedActivity: vi.fn(),
  translateTargetLang: null as string | null,
  highlightTheme: 'github-dark' as const,
  setHighlightTheme: vi.fn(),
  articleFont: 'sans' as const,
  setArticleFont: vi.fn(),
  save: vi.fn(),
}

function OutletWrapper() {
  return <Outlet context={{ settings: mockSettings, sidebarOpen: false, setSidebarOpen: vi.fn() }} />
}

function renderArticleList(initialPath = '/inbox') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
        <Routes>
          <Route element={<OutletWrapper />}>
            <Route path="feeds/:feedId" element={<ArticleList listLabel="Test List" />} />
            <Route path="*" element={<ArticleList listLabel="Test List" />} />
          </Route>
        </Routes>
      </LocaleContext.Provider>
    </MemoryRouter>,
  )
}

describe('ArticleList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue({ translated_titles: {} })
    swrFeedsData = undefined
    swrInboxSummaryData = undefined
    mockSettings.autoMarkRead = 'off' as any
    mockSettings.translateTargetLang = null
    // Stub IntersectionObserver for tests that enable autoMarkRead
    vi.stubGlobal('IntersectionObserver', class {
      constructor() {}
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    })
    // Reset to loading state
    swrInfiniteReturn = {
      data: undefined,
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    }
  })

  it('shows skeleton when loading', () => {
    renderArticleList()
    // Skeleton renders divs with animate-pulse class
    const pulses = document.querySelectorAll('.animate-pulse')
    expect(pulses.length).toBeGreaterThan(0)
  })

  it('shows empty state when no articles', () => {
    swrInfiniteReturn = {
      data: [{ articles: [], total: 0, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('No articles yet. Add a feed to get started.')).toBeTruthy()
  })

  it('shows error state with retry button', () => {
    swrInfiniteReturn = {
      data: undefined,
      error: new Error('fetch failed'),
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('Failed to load')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('renders article cards', () => {
    swrInfiniteReturn = {
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'First Article' }),
          makeArticle({ id: 2, title: 'Second Article' }),
        ],
        total: 2,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('First Article')).toBeTruthy()
    expect(screen.getByText('Second Article')).toBeTruthy()
  })

  it('renders inbox header and chat trigger on inbox', () => {
    swrInboxSummaryData = {
      unread_total: 2,
      new_today: 1,
      oldest_unread_at: '2026-01-01T00:00:00Z',
      source_feed_count: 1,
    }
    swrInfiniteReturn = {
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'First Article' }),
          makeArticle({ id: 2, title: 'Second Article' }),
        ],
        total: 2,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList()

    expect(screen.getByText('Unread')).toBeTruthy()
    expect(screen.getByText('New today')).toBeTruthy()
    expect(screen.getByText('Latest')).toBeTruthy()
    expect(screen.getByText('Backlog')).toBeTruthy()
    expect(screen.getByText('High value')).toBeTruthy()
    expect(screen.getByText('No grouping')).toBeTruthy()
    expect(screen.getByText('By day')).toBeTruthy()
    expect(screen.getByText('By feed')).toBeTruthy()
    expect(screen.getByText('Chat')).toBeTruthy()
  })

  it('translates loaded titles after clicking top translate button and keeps cached results', async () => {
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, title: 'Bonjour', lang: 'fr' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    const deferred = createDeferred<{ translated_titles: Record<number, string> }>()
    mockApiPost.mockReturnValueOnce(deferred.promise)
    renderArticleList()

    fireEvent.click(getTopTranslateButton('Translate'))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/articles/translate-titles', { ids: [1] }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translating…' })).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Translating…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Translating…' }))
    expect(mockApiPost).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve({ translated_titles: { 1: 'Hello' } })
    })
    expect(await screen.findByText('Hello')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Translated' })).toBeTruthy()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Translated the current list titles'))

    fireEvent.click(screen.getByRole('button', { name: 'Translated' }))
    expect(getTopTranslateButton('Translate')).toBeTruthy()
    expect(screen.getByText('Bonjour')).toBeTruthy()

    fireEvent.click(getTopTranslateButton('Translate'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translated' })).toBeTruthy())
    expect(mockApiPost).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Hello')).toBeTruthy()
  })

  it('uses translate target language instead of UI locale for title translation', async () => {
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, title: 'Hello world', lang: 'en' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    mockSettings.translateTargetLang = 'zh'
    mockApiPost.mockResolvedValue({ translated_titles: { 1: '你好，世界' } })

    renderArticleList()

    fireEvent.click(getTopTranslateButton('Translate'))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/articles/translate-titles', { ids: [1] }))
    expect(await screen.findByText('你好，世界')).toBeTruthy()
  })

  it('shows a dedicated error state when title translation fails', async () => {
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, title: 'Bonjour', lang: 'fr' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    mockApiPost.mockRejectedValueOnce(new Error('boom'))
    renderArticleList()

    fireEvent.click(getTopTranslateButton('Translate'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Translation failed'))
    expect(screen.getByRole('button', { name: 'Translation failed' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Translation failed' }) as HTMLButtonElement).title).toBe('Translation failed')
    expect(screen.getByText('Bonjour')).toBeTruthy()
  })

  it('does not render floating list chat fab trigger on inbox when articles are present', () => {
    swrInfiniteReturn = {
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'First Article' }),
          makeArticle({ id: 2, title: 'Second Article' }),
        ],
        total: 2,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList()

    expect(screen.getByTestId('list-chat-fab').getAttribute('data-article-count')).toBe('2')
    expect(screen.getAllByText('Chat')).toHaveLength(1)
  })

  it('renders floating list chat fab on non-inbox pages', () => {
    swrInfiniteReturn = {
      data: [{
        articles: [makeArticle({ id: 1, title: 'First Article' })],
        total: 1,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList('/feeds/1')

    expect(screen.getByTestId('list-chat-fab').getAttribute('data-article-count')).toBe('1')
  })

  it('shows inbox all-read actions when unread list becomes empty but total_all exists', () => {
    swrInfiniteReturn = {
      data: [{ articles: [], total: 0, total_all: 3, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList()
    expect(screen.getByText('Inbox is clear. Choose your next step.')).toBeTruthy()
    expect(screen.getByText('Fetch updates')).toBeTruthy()
    expect(screen.getByText('View bookmarks')).toBeTruthy()
    expect(screen.getByText('Browse history')).toBeTruthy()
    expect(screen.getAllByText('Chat').length).toBeGreaterThan(0)
  })

  it('groups inbox articles by feed when grouping mode changes', () => {
    swrInboxSummaryData = {
      unread_total: 3,
      new_today: 2,
      oldest_unread_at: '2026-01-01T00:00:00Z',
      source_feed_count: 2,
    }
    swrInfiniteReturn = {
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'One', feed_id: 1, feed_name: 'Feed A' }),
          makeArticle({ id: 2, title: 'Two', feed_id: 1, feed_name: 'Feed A' }),
          makeArticle({ id: 3, title: 'Three', feed_id: 2, feed_name: 'Feed B' }),
        ],
        total: 3,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList()
    fireEvent.click(screen.getByText('By feed'))

    expect(screen.getByText('Feed A')).toBeTruthy()
    expect(screen.getByText('Feed B')).toBeTruthy()
  })

  it('dedupes day group headers across flattened paginated data', () => {
    swrInboxSummaryData = {
      unread_total: 3,
      new_today: 0,
      oldest_unread_at: '2026-01-01T00:00:00Z',
      source_feed_count: 1,
    }
    swrInfiniteReturn = {
      data: [
        {
          articles: [
            makeArticle({ id: 1, title: 'Page 1', published_at: '2026-01-01T09:00:00Z' }),
            makeArticle({ id: 2, title: 'Page 2', published_at: '2026-01-01T08:00:00Z' }),
          ],
          total: 3,
          has_more: true,
        },
        {
          articles: [
            makeArticle({ id: 3, title: 'Page 3', published_at: '2026-01-01T07:00:00Z' }),
          ],
          total: 3,
          has_more: false,
        },
      ],
      error: undefined,
      size: 2,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList()
    fireEvent.click(screen.getByText('By day'))

    expect(screen.getAllByText('Jan 1')).toHaveLength(1)
  })

  it('passes social feed view type to cards', () => {
    swrInfiniteReturn = {
      data: [{
        articles: [makeArticle({ id: 7, title: 'Social Article', feed_view_type: 'social' })],
        total: 1,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList()
    expect(screen.getByTestId('article-7').getAttribute('data-feed-view-type')).toBe('social')
  })

  it('shows mascot at end of feed', () => {
    mockSettings.autoMarkRead = 'on' as any
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1 })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByTestId('mascot')).toBeTruthy()
    expect(screen.getByText("You're all caught up!")).toBeTruthy()
  })

  it('does not show mascot when article list is empty', () => {
    swrInfiniteReturn = {
      data: [{ articles: [], total: 0, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.queryByTestId('mascot')).toBeNull()
  })

  it('uses ArticleCard on non-touch devices', () => {
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 10, title: 'Desktop Article' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByTestId('article-10')).toBeTruthy()
  })

  it('uses SwipeableArticleCard on touch devices', async () => {
    const { useIsTouchDevice } = await import('../../hooks/use-is-touch-device')
    vi.mocked(useIsTouchDevice).mockReturnValue(true)

    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 20, title: 'Mobile Article' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByTestId('swipeable-20')).toBeTruthy()
  })

  it('does not show mascot when still loading', () => {
    renderArticleList()
    expect(screen.queryByTestId('mascot')).toBeNull()
  })

  it('renders multiple pages of articles', () => {
    swrInfiniteReturn = {
      data: [
        { articles: [makeArticle({ id: 1, title: 'Page 1' })], total: 2, has_more: true },
        { articles: [makeArticle({ id: 2, title: 'Page 2' })], total: 2, has_more: false },
      ],
      error: undefined,
      size: 2,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    expect(screen.getByText('Page 1')).toBeTruthy()
    expect(screen.getByText('Page 2')).toBeTruthy()
  })

  it('renders FeedMetricsBar for current feed', () => {
    swrFeedsData = {
      feeds: [
        { id: 1, name: 'My Feed', type: 'rss', unread_count: 5, total_count: 10 },
      ],
    }
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, feed_id: 1 })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList('/feeds/1')
    expect(screen.getByTestId('metrics-bar')).toBeTruthy()
    expect(screen.getByText('My Feed')).toBeTruthy()
  })

  it('does not render FeedMetricsBar for clip feed', () => {
    swrFeedsData = {
      feeds: [
        { id: 1, name: 'Clip Feed', type: 'clip', unread_count: 0, total_count: 3 },
      ],
    }
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, feed_id: 1 })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList('/feeds/1')
    expect(screen.queryByTestId('metrics-bar')).toBeNull()
  })

  it('shows article kind filters for X feeds and refetches when changed', () => {
    const mockSetSize = vi.fn()
    swrFeedsData = {
      feeds: [
        {
          id: 1,
          name: 'X Feed',
          type: 'rss',
          url: 'https://x.com/example',
          rss_url: 'https://rsshub.app/twitter/user/example',
          rss_bridge_url: null,
          unread_count: 1,
          article_count: 1,
        },
      ],
    }
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, feed_id: 1, article_kind: 'repost' })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: mockSetSize,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList('/feeds/1')
    expect(screen.getByText('All')).toBeTruthy()
    expect(screen.getByText('Original')).toBeTruthy()
    expect(screen.getByText('Repost')).toBeTruthy()
    expect(screen.getByText('Quote')).toBeTruthy()

    fireEvent.click(screen.getByText('Repost'))
    expect(mockSetSize).toHaveBeenCalledWith(1)
  })

  it('does not show article kind filters for non-X feeds', () => {
    swrFeedsData = {
      feeds: [
        {
          id: 1,
          name: 'Blog Feed',
          type: 'rss',
          url: 'https://example.com',
          rss_url: 'https://example.com/rss',
          rss_bridge_url: null,
          unread_count: 1,
          article_count: 1,
        },
      ],
    }
    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1, feed_id: 1 })], total: 1, has_more: false }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }

    renderArticleList('/feeds/1')
    expect(screen.queryByText('Original')).toBeNull()
    expect(screen.queryByText('Repost')).toBeNull()
    expect(screen.queryByText('Quote')).toBeNull()
  })

  it('retry button resets pagination', () => {
    const mockSetSize = vi.fn()
    swrInfiniteReturn = {
      data: undefined,
      error: new Error('fetch failed'),
      size: 3,
      setSize: mockSetSize,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    screen.getByText('Retry').click()
    expect(mockSetSize).toHaveBeenCalledWith(1)
  })

  it('skeleton respects showThumbnails=off', () => {
    mockSettings.showThumbnails = 'off' as any
    swrInfiniteReturn = {
      data: undefined,
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: true,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    // When showThumbnails is off, the 16x16 thumbnail placeholder should not be rendered
    const skeletonThumbnails = document.querySelectorAll('.w-16.h-16')
    expect(skeletonThumbnails.length).toBe(0)
    // Restore default
    mockSettings.showThumbnails = 'on' as any
  })

  it('data-article-unread attribute is set correctly', () => {
    swrInfiniteReturn = {
      data: [{
        articles: [
          makeArticle({ id: 1, title: 'Unread', seen_at: null }),
          makeArticle({ id: 2, title: 'Read', seen_at: '2026-01-01' }),
        ],
        total: 2,
        has_more: false,
      }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }
    renderArticleList()
    const unreadEl = document.querySelector('[data-article-id="1"]')
    const readEl = document.querySelector('[data-article-id="2"]')
    expect(unreadEl?.getAttribute('data-article-unread')).toBe('1')
    expect(readEl?.getAttribute('data-article-unread')).toBe('0')
  })

  it('validating state shows skeleton in sentinel', () => {
    // Stub IntersectionObserver for this test since sentinel ref callback uses it
    const observeMock = vi.fn()
    const disconnectMock = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor() {}
      observe = observeMock
      unobserve = vi.fn()
      disconnect = disconnectMock
    })

    swrInfiniteReturn = {
      data: [{ articles: [makeArticle({ id: 1 })], total: 2, has_more: true }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
      isValidating: true,
      mutate: vi.fn(),
    }
    renderArticleList()
    // Sentinel area should contain skeleton loading indicators (animate-pulse)
    const pulses = document.querySelectorAll('.animate-pulse')
    expect(pulses.length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })
})
