import type { FeedPriorityLevel } from '../../shared/types'

export const DEFAULT_FEED_PRIORITY: FeedPriorityLevel = 3
export const FEED_PRIORITY_LEVELS: FeedPriorityLevel[] = [1, 2, 3, 4, 5]

export type FeedPrioritySource = {
  feed_priority?: FeedPriorityLevel
  priority_level?: FeedPriorityLevel
}

export function getFeedPriorityLevel(feed: FeedPrioritySource | null | undefined): FeedPriorityLevel {
  return feed?.feed_priority ?? feed?.priority_level ?? DEFAULT_FEED_PRIORITY
}

export function buildFeedPriorityPatch(priorityLevel: FeedPriorityLevel) {
  return {
    feed_priority: priorityLevel,
    priority_level: priorityLevel,
  }
}
