import type { FastifyInstance } from 'fastify'
import { getReadingStats, getBookmarkCount, getLikeCount } from '../db.js'
import { getDb } from '../db/connection.js'
import { getRequestUserId } from '../auth.js'

export async function statsRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/stats', async (request, reply) => {
    const { since, until } = request.query as { since?: string; until?: string }
    const userId = getRequestUserId(request)
    const stats = getReadingStats({ since, until, userId })

    const feedCount = (
      userId != null
        ? getDb().prepare('SELECT COUNT(*) AS cnt FROM feeds WHERE user_id = ?').get(userId)
        : getDb().prepare('SELECT COUNT(*) AS cnt FROM feeds').get()
    ) as { cnt: number }
    const feedCountValue = feedCount.cnt
    const categoryCount = (
      userId != null
        ? getDb().prepare('SELECT COUNT(*) AS cnt FROM categories WHERE user_id = ?').get(userId)
        : getDb().prepare('SELECT COUNT(*) AS cnt FROM categories').get()
    ) as { cnt: number }
    const categoryCountValue = categoryCount.cnt
    const bookmarked = getBookmarkCount(userId)
    const liked = getLikeCount(userId)

    reply.send({
      total_articles: stats.total,
      unread_articles: stats.unread,
      read_articles: stats.read,
      bookmarked_articles: bookmarked,
      liked_articles: liked,
      total_feeds: feedCountValue,
      total_categories: categoryCountValue,
      by_feed: stats.by_feed,
    })
  })
}
