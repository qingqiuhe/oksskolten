import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getArticleById, getHighValueInbox, upsertInboxTopicCooldown } from '../db.js'
import { getRequestUserId, requireJson } from '../auth.js'
import { parseOrBadRequest } from '../lib/validation.js'

const HighValueQuery = z.object({
  limit: z.coerce.number().int().positive().optional(),
  feed_view_type: z.enum(['article', 'social']).optional(),
})

const TopicCooldownBody = z.object({
  anchor_article_id: z.number().int().positive(),
})

export async function inboxRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/inbox/high-value', async (request, reply) => {
    const query = parseOrBadRequest(HighValueQuery, request.query, reply)
    if (!query) return

    reply.send(getHighValueInbox({
      limit: query.limit,
      feedViewType: query.feed_view_type,
      userId: getRequestUserId(request),
    }))
  })

  api.post(
    '/api/inbox/topic-cooldowns',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(TopicCooldownBody, request.body, reply)
      if (!body) return

      const userId = getRequestUserId(request)
      const article = getArticleById(body.anchor_article_id, userId)
      if (!article) {
        reply.status(404).send({ error: 'Article not found' })
        return
      }

      reply.send(upsertInboxTopicCooldown(body.anchor_article_id, userId))
    },
  )
}
