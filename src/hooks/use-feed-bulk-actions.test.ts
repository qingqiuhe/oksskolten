import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedWithCounts } from '../../shared/types'
import { useFeedBulkActions } from './use-feed-bulk-actions'

vi.mock('../lib/fetcher', () => ({
  apiPost: vi.fn().mockResolvedValue(undefined),
  apiDelete: vi.fn().mockResolvedValue(undefined),
}))

import { apiDelete, apiPost } from '../lib/fetcher'

type FeedsData = {
  feeds: FeedWithCounts[]
  bookmark_count: number
  like_count: number
  clip_feed_id: number | null
}

function makeFeed(overrides: Partial<FeedWithCounts> = {}): FeedWithCounts {
  return {
    id: 1,
    name: 'Test Feed',
    url: 'https://example.com',
    icon_url: null,
    rss_url: null,
    rss_bridge_url: null,
    view_type: null,
    category_id: null,
    last_error: null,
    error_count: 0,
    disabled: 0,
    requires_js_challenge: 0,
    type: 'rss',
    etag: null,
    last_modified: null,
    last_content_hash: null,
    next_check_at: null,
    check_interval: null,
    created_at: '2024-01-01',
    category_name: null,
    article_count: 10,
    unread_count: 5,
    priority_level: 3,
    articles_per_week: 2,
    latest_published_at: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

function makeOpts(overrides: Partial<Parameters<typeof useFeedBulkActions>[0]> = {}) {
  return {
    feeds: [makeFeed()],
    selectedFeedIds: new Set<number>(),
    mutateFeeds: vi.fn(),
    clearSelection: vi.fn(),
    startFeedFetch: vi.fn().mockResolvedValue({ totalNew: 0 }),
    onMarkAllRead: vi.fn(),
    onFetchComplete: vi.fn(),
    onDeleted: vi.fn(),
    ...overrides,
  }
}

async function waitForCalls(mock: { mock: { calls: unknown[] } }, count: number) {
  for (let attempts = 0; attempts < 20 && mock.mock.calls.length < count; attempts += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('useFeedBulkActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves only eligible selected feeds and revalidates on failure', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('network'))
    const feedA = makeFeed({ id: 1, category_id: null })
    const feedB = makeFeed({ id: 2, category_id: 7 })
    const clipFeed = makeFeed({ id: 3, type: 'clip' })
    const opts = makeOpts({
      feeds: [feedA, feedB, clipFeed],
      selectedFeedIds: new Set([1, 2, 3]),
    })
    const { result } = renderHook(() => useFeedBulkActions(opts))

    await act(async () => {
      await result.current.handleBulkMoveToCategory(7)
    })

    expect(opts.clearSelection).toHaveBeenCalled()
    expect(opts.mutateFeeds).toHaveBeenNthCalledWith(1, expect.any(Function), { revalidate: false })
    expect(opts.mutateFeeds).toHaveBeenNthCalledWith(2)
    expect(apiPost).toHaveBeenCalledWith('/api/feeds/bulk-move', { feed_ids: [1], category_id: 7 })

    const updater = vi.mocked(opts.mutateFeeds).mock.calls[0]?.[0] as (data: FeedsData) => FeedsData
    expect(updater({
      feeds: [feedA, feedB, clipFeed],
      bookmark_count: 0,
      like_count: 0,
      clip_feed_id: 3,
    }).feeds.map(feed => ({ id: feed.id, category_id: feed.category_id }))).toEqual([
      { id: 1, category_id: 7 },
      { id: 2, category_id: 7 },
      { id: 3, category_id: null },
    ])
  })

  it('marks selected non-clip feeds as read and triggers callbacks', async () => {
    const feedA = makeFeed({ id: 1 })
    const clipFeed = makeFeed({ id: 2, type: 'clip' })
    const opts = makeOpts({
      feeds: [feedA, clipFeed],
      selectedFeedIds: new Set([1, 2]),
    })
    const { result } = renderHook(() => useFeedBulkActions(opts))

    await act(async () => {
      await result.current.handleBulkMarkAllRead()
    })

    expect(opts.clearSelection).toHaveBeenCalled()
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/api/feeds/1/mark-all-seen')
    expect(opts.mutateFeeds).toHaveBeenCalled()
    expect(opts.onMarkAllRead).toHaveBeenCalled()
  })

  it('limits bulk mark-all-read request concurrency', async () => {
    const feeds = Array.from({ length: 8 }, (_, index) => makeFeed({ id: index + 1 }))
    let activeRequests = 0
    let maxActiveRequests = 0
    const resolvers: Array<() => void> = []
    vi.mocked(apiPost).mockImplementation(async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await new Promise<void>(resolve => resolvers.push(resolve))
      activeRequests -= 1
      return undefined
    })
    const opts = makeOpts({
      feeds,
      selectedFeedIds: new Set(feeds.map(feed => feed.id)),
    })
    const { result } = renderHook(() => useFeedBulkActions(opts))

    let actionPromise!: Promise<void>
    act(() => {
      actionPromise = result.current.handleBulkMarkAllRead()
    })

    await waitForCalls(vi.mocked(apiPost), 4)
    expect(apiPost).toHaveBeenCalledTimes(4)
    expect(maxActiveRequests).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    await waitForCalls(vi.mocked(apiPost), 8)
    expect(apiPost).toHaveBeenCalledTimes(8)
    expect(maxActiveRequests).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    await act(async () => {
      await actionPromise
    })
    expect(opts.onMarkAllRead).toHaveBeenCalled()
  })

  it('fetches only enabled selected feeds and annotates results with names', async () => {
    const activeFeed = makeFeed({ id: 1, name: 'Active Feed', disabled: 0 })
    const disabledFeed = makeFeed({ id: 2, name: 'Disabled Feed', disabled: 1 })
    const opts = makeOpts({
      feeds: [activeFeed, disabledFeed],
      selectedFeedIds: new Set([1, 2]),
      startFeedFetch: vi.fn().mockResolvedValue({ totalNew: 4 }),
    })
    const { result } = renderHook(() => useFeedBulkActions(opts))

    await act(async () => {
      await result.current.handleBulkFetch()
    })

    expect(opts.clearSelection).toHaveBeenCalled()
    expect(opts.startFeedFetch).toHaveBeenCalledTimes(1)
    expect(opts.startFeedFetch).toHaveBeenCalledWith(1)
    expect(opts.onFetchComplete).toHaveBeenCalledWith({ totalNew: 4, name: 'Active Feed' })
  })

  it('fetches selected feeds with bounded concurrency', async () => {
    const feeds = Array.from({ length: 8 }, (_, index) => makeFeed({ id: index + 1, name: `Feed ${index + 1}` }))
    let activeFetches = 0
    let maxActiveFetches = 0
    const resolvers: Array<() => void> = []
    const startFeedFetch = vi.fn(async () => {
      activeFetches += 1
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
      await new Promise<void>(resolve => resolvers.push(resolve))
      activeFetches -= 1
      return { totalNew: 1 }
    })
    const opts = makeOpts({
      feeds,
      selectedFeedIds: new Set(feeds.map(feed => feed.id)),
      startFeedFetch,
    })
    const { result } = renderHook(() => useFeedBulkActions(opts))

    let actionPromise!: Promise<void>
    act(() => {
      actionPromise = result.current.handleBulkFetch()
    })

    await waitForCalls(startFeedFetch, 4)
    expect(startFeedFetch).toHaveBeenCalledTimes(4)
    expect(maxActiveFetches).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    await waitForCalls(startFeedFetch, 8)
    expect(startFeedFetch).toHaveBeenCalledTimes(8)
    expect(maxActiveFetches).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    await act(async () => {
      await actionPromise
    })
    expect(opts.onFetchComplete).toHaveBeenCalledTimes(8)
  })

  it('shows delete confirmation and deletes selected feeds optimistically', async () => {
    const feedA = makeFeed({ id: 1 })
    const feedB = makeFeed({ id: 2 })
    const opts = makeOpts({
      feeds: [feedA, feedB],
      selectedFeedIds: new Set([1, 2]),
    })
    const { result } = renderHook(() => useFeedBulkActions(opts))

    act(() => {
      result.current.handleBulkDelete()
    })

    expect(result.current.bulkDeleteConfirm).toBe(true)

    await act(async () => {
      await result.current.handleBulkDeleteConfirm()
    })

    expect(result.current.bulkDeleteConfirm).toBe(false)
    expect(opts.clearSelection).toHaveBeenCalled()
    expect(opts.mutateFeeds).toHaveBeenNthCalledWith(1, expect.any(Function), { revalidate: false })
    expect(opts.mutateFeeds).toHaveBeenNthCalledWith(2)
    expect(apiDelete).toHaveBeenCalledTimes(2)
    expect(apiDelete).toHaveBeenNthCalledWith(1, '/api/feeds/1')
    expect(apiDelete).toHaveBeenNthCalledWith(2, '/api/feeds/2')
    expect(opts.onDeleted).toHaveBeenCalledWith([1, 2])

    const updater = vi.mocked(opts.mutateFeeds).mock.calls[0]?.[0] as (data: FeedsData) => FeedsData
    expect(updater({
      feeds: [feedA, feedB],
      bookmark_count: 0,
      like_count: 0,
      clip_feed_id: null,
    }).feeds).toEqual([])
  })

  it('limits bulk delete request concurrency', async () => {
    const feeds = Array.from({ length: 8 }, (_, index) => makeFeed({ id: index + 1 }))
    let activeRequests = 0
    let maxActiveRequests = 0
    const resolvers: Array<() => void> = []
    vi.mocked(apiDelete).mockImplementation(async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await new Promise<void>(resolve => resolvers.push(resolve))
      activeRequests -= 1
      return undefined
    })
    const opts = makeOpts({
      feeds,
      selectedFeedIds: new Set(feeds.map(feed => feed.id)),
    })
    const { result } = renderHook(() => useFeedBulkActions(opts))

    act(() => {
      result.current.handleBulkDelete()
    })

    let actionPromise!: Promise<void>
    act(() => {
      actionPromise = result.current.handleBulkDeleteConfirm()
    })

    await waitForCalls(vi.mocked(apiDelete), 4)
    expect(apiDelete).toHaveBeenCalledTimes(4)
    expect(maxActiveRequests).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    await waitForCalls(vi.mocked(apiDelete), 8)
    expect(apiDelete).toHaveBeenCalledTimes(8)
    expect(maxActiveRequests).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    await act(async () => {
      await actionPromise
    })
    expect(opts.onDeleted).toHaveBeenCalledWith(feeds.map(feed => feed.id))
  })
})
