import type { FeedWithCounts } from '../../shared/types'

export interface FeedsCacheData {
  feeds: FeedWithCounts[]
  bookmark_count?: number
  like_count?: number
  clip_feed_id?: number | null
}

export interface FeedCountDelta {
  feedId: number
  articleDelta?: number
  unreadDelta?: number
}

export interface FeedsCachePatch {
  feedDeltas?: FeedCountDelta[]
  bookmarkDelta?: number
  likeDelta?: number
}

function clampCount(value: number): number {
  return Math.max(0, value)
}

export function applyFeedsCachePatch<T extends FeedsCacheData | undefined>(
  data: T,
  patch: FeedsCachePatch,
): T {
  if (!data) return data

  const feedDeltas = new Map<number, { articleDelta: number; unreadDelta: number }>()
  for (const delta of patch.feedDeltas ?? []) {
    const current = feedDeltas.get(delta.feedId) ?? { articleDelta: 0, unreadDelta: 0 }
    current.articleDelta += delta.articleDelta ?? 0
    current.unreadDelta += delta.unreadDelta ?? 0
    feedDeltas.set(delta.feedId, current)
  }

  const next = {
    ...data,
    feeds: feedDeltas.size === 0
      ? data.feeds
      : data.feeds.map(feed => {
          const delta = feedDeltas.get(feed.id)
          if (!delta) return feed
          return {
            ...feed,
            article_count: clampCount(feed.article_count + delta.articleDelta),
            unread_count: clampCount(feed.unread_count + delta.unreadDelta),
          }
        }),
  }

  if (patch.bookmarkDelta != null && next.bookmark_count != null) {
    next.bookmark_count = clampCount(next.bookmark_count + patch.bookmarkDelta)
  }
  if (patch.likeDelta != null && next.like_count != null) {
    next.like_count = clampCount(next.like_count + patch.likeDelta)
  }

  return next as T
}
