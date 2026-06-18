import type { FastifyInstance } from 'fastify'
import { getReadingStats } from '../db.js'
import { getDb } from '../db/connection.js'
import { getRequestUserId } from '../auth.js'

export async function statsRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/stats', async (request, reply) => {
    const { since, until } = request.query as { since?: string; until?: string }
    const userId = getRequestUserId(request)
    const stats = getReadingStats({ since, until, userId })

    const metadataCounts = (
      userId != null
        ? getDb().prepare(`
          SELECT
            (SELECT COUNT(*) FROM feeds WHERE user_id = ?) AS feed_count,
            (SELECT COUNT(*) FROM categories WHERE user_id = ?) AS category_count,
            (SELECT COUNT(*) FROM active_articles WHERE user_id = ? AND bookmarked_at IS NOT NULL) AS bookmark_count,
            (SELECT COUNT(*) FROM active_articles WHERE user_id = ? AND liked_at IS NOT NULL) AS like_count
        `).get(userId, userId, userId, userId)
        : getDb().prepare(`
          SELECT
            (SELECT COUNT(*) FROM feeds) AS feed_count,
            (SELECT COUNT(*) FROM categories) AS category_count,
            (SELECT COUNT(*) FROM active_articles WHERE bookmarked_at IS NOT NULL) AS bookmark_count,
            (SELECT COUNT(*) FROM active_articles WHERE liked_at IS NOT NULL) AS like_count
        `).get()
    ) as { feed_count: number; category_count: number; bookmark_count: number; like_count: number }

    reply.send({
      total_articles: stats.total,
      unread_articles: stats.unread,
      read_articles: stats.read,
      bookmarked_articles: metadataCounts.bookmark_count,
      liked_articles: metadataCounts.like_count,
      total_feeds: metadataCounts.feed_count,
      total_categories: metadataCounts.category_count,
      by_feed: stats.by_feed,
    })
  })
}
