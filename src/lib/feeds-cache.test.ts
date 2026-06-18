import { describe, expect, it } from 'vitest'
import { applyFeedsCachePatch, type FeedsCacheData } from './feeds-cache'
import type { FeedWithCounts } from '../../shared/types'

function makeFeed(overrides: Partial<FeedWithCounts> = {}): FeedWithCounts {
  return {
    id: 1,
    name: 'Example',
    url: 'https://example.com/feed',
    icon_url: null,
    rss_url: null,
    rss_bridge_url: null,
    view_type: null,
    category_id: null,
    priority_level: 3,
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
    created_at: '2026-01-01T00:00:00Z',
    category_name: null,
    article_count: 10,
    unread_count: 4,
    articles_per_week: 1,
    latest_published_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('applyFeedsCachePatch', () => {
  it('updates only affected feed counters', () => {
    const data: FeedsCacheData = {
      feeds: [
        makeFeed({ id: 1, article_count: 10, unread_count: 4 }),
        makeFeed({ id: 2, article_count: 8, unread_count: 3 }),
      ],
      bookmark_count: 5,
      like_count: 2,
      clip_feed_id: null,
    }

    const result = applyFeedsCachePatch(data, {
      feedDeltas: [{ feedId: 2, articleDelta: -1, unreadDelta: -1 }],
    })

    expect(result.feeds[0]).toEqual(data.feeds[0])
    expect(result.feeds[1].article_count).toBe(7)
    expect(result.feeds[1].unread_count).toBe(2)
    expect(result.bookmark_count).toBe(5)
    expect(result.like_count).toBe(2)
  })

  it('coalesces repeated feed deltas and clamps counts at zero', () => {
    const data: FeedsCacheData = {
      feeds: [makeFeed({ id: 1, article_count: 1, unread_count: 1 })],
    }

    const result = applyFeedsCachePatch(data, {
      feedDeltas: [
        { feedId: 1, articleDelta: -1, unreadDelta: -1 },
        { feedId: 1, articleDelta: -1, unreadDelta: -1 },
      ],
    })

    expect(result.feeds[0].article_count).toBe(0)
    expect(result.feeds[0].unread_count).toBe(0)
  })

  it('updates collection counters when present', () => {
    const data: FeedsCacheData = {
      feeds: [makeFeed()],
      bookmark_count: 0,
      like_count: 3,
      clip_feed_id: null,
    }

    const result = applyFeedsCachePatch(data, {
      bookmarkDelta: 1,
      likeDelta: -5,
    })

    expect(result.bookmark_count).toBe(1)
    expect(result.like_count).toBe(0)
  })
})
