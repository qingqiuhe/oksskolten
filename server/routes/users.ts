import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hashSync } from 'bcryptjs'
import {
  createCategory,
  createFeed,
  createUser,
  getDb,
  getUserById,
  issueInvitation,
  listUsers,
  revokeUserSessions,
  updateUser,
} from '../db.js'
import { getOrigin, getRequestIdentity, requireAuth, requireJson, requireRoles } from '../auth.js'
import { fetchSingleFeed } from '../fetcher.js'
import { roleCanManage, type UserRole, type UserStatus } from '../identity.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'
import type { Feed } from '../../shared/types.js'

const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12
const INVITE_TTL_DAYS = 7

const CreateUserBody = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member'] as const),
  import_feed_ids: z.array(z.number().int().positive()).optional(),
})

const UpdateUserBody = z.object({
  role: z.enum(['owner', 'admin', 'member'] as const).optional(),
  status: z.enum(['active', 'invited', 'disabled'] as const).optional(),
  github_login: z.string().nullable().optional(),
})

function assertCanManage(actorRole: UserRole, targetRole: UserRole): string | null {
  if (!roleCanManage(actorRole, targetRole)) {
    return 'Forbidden'
  }
  return null
}

function invitationPayload(requestUrlOrigin: string, token: string) {
  return {
    token,
    invite_url: `${requestUrlOrigin}/invite/${token}`,
  }
}

function inviteExpiry(): string {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

interface SourceFeedRow {
  id: number
  name: string
  url: string
  icon_url: string | null
  rss_url: string | null
  rss_bridge_url: string | null
  view_type: Feed['view_type']
  requires_js_challenge: number
  category_id: number | null
  category_name: string | null
  type: Feed['type']
  ingest_kind?: Feed['ingest_kind']
  source_config_json?: string | null
}

export async function userRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/users', { preHandler: [requireAuth, requireRoles(['owner', 'admin'])] }, async (_request, reply) => {
    reply.send({ users: listUsers() })
  })

  api.post('/api/users', {
    preHandler: [requireAuth, requireJson, requireRoles(['owner', 'admin'])],
  }, async (request, reply) => {
    const body = parseOrBadRequest(CreateUserBody, request.body, reply)
    if (!body) return

    const identity = getRequestIdentity(request)
    if (!identity?.role) {
      return reply.status(403).send({ error: 'Forbidden' })
    }
    const inviterUserId = identity.userId ?? null
    if (identity.role === 'admin' && body.role !== 'member') {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    const importFeedIds = Array.from(new Set(body.import_feed_ids ?? []))
    const importedFeedsToFetch: Feed[] = []
    const db = getDb()
    const placeholders = importFeedIds.map(() => '?').join(',')
    let sourceFeeds: SourceFeedRow[] = []

    if (importFeedIds.length > 0) {
      const sourceFeedQuery = inviterUserId == null
        ? db.prepare(`
        SELECT
          f.id,
          f.name,
          f.url,
          f.icon_url,
          f.rss_url,
          f.rss_bridge_url,
          f.view_type,
          f.requires_js_challenge,
          f.ingest_kind,
          f.source_config_json,
          f.category_id,
          c.name AS category_name,
          f.type
        FROM feeds f
        LEFT JOIN categories c ON c.id = f.category_id
        WHERE f.user_id IS NULL
          AND f.id IN (${placeholders})
      `)
        : db.prepare(`
        SELECT
          f.id,
          f.name,
          f.url,
          f.icon_url,
          f.rss_url,
          f.rss_bridge_url,
          f.view_type,
          f.requires_js_challenge,
          f.ingest_kind,
          f.source_config_json,
          f.category_id,
          c.name AS category_name,
          f.type
        FROM feeds f
        LEFT JOIN categories c ON c.id = f.category_id
        WHERE f.user_id = ?
          AND f.id IN (${placeholders})
      `)

      sourceFeeds = (inviterUserId == null
        ? sourceFeedQuery.all(...importFeedIds)
        : sourceFeedQuery.all(inviterUserId, ...importFeedIds)) as SourceFeedRow[]

      if (sourceFeeds.length !== importFeedIds.length) {
        return reply.status(400).send({ error: 'Invalid import feed selection' })
      }
      if (sourceFeeds.some(feed => feed.type === 'clip')) {
        return reply.status(400).send({ error: 'Clip feeds cannot be imported' })
      }
    }

    const result = db.transaction(() => {
      const user = createUser({
        email: body.email,
        passwordHash: hashSync(`${body.email}:${Date.now()}`, BCRYPT_ROUNDS),
        role: body.role,
        status: 'invited',
        invitedBy: inviterUserId,
      })

      const categoryMap = new Map<number, number>()
      let importedCategoryCount = 0

      for (const feed of sourceFeeds) {
        if (feed.category_id == null) continue
        if (categoryMap.has(feed.category_id)) continue
        const createdCategory = createCategory(feed.category_name ?? 'Imported', user.id)
        categoryMap.set(feed.category_id, createdCategory.id)
        importedCategoryCount++
      }

      for (const feed of sourceFeeds) {
        const importedFeed = createFeed({
          name: feed.name,
          url: feed.url,
          icon_url: feed.icon_url,
          rss_url: feed.rss_url,
          rss_bridge_url: feed.rss_bridge_url,
          view_type: feed.view_type,
          category_id: feed.category_id == null ? null : (categoryMap.get(feed.category_id) ?? null),
          requires_js_challenge: feed.requires_js_challenge,
          type: 'rss',
          ingest_kind: feed.ingest_kind ?? 'rss',
          source_config_json: feed.source_config_json ?? null,
        }, user.id)
        importedFeedsToFetch.push(importedFeed)
      }

      const token = crypto.randomUUID()
      db.prepare(`
        INSERT INTO invitations (user_id, token, created_by, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(user.id, token, inviterUserId, inviteExpiry())

      return {
        user,
        token,
        import_result: {
          imported_feed_count: sourceFeeds.length,
          imported_category_count: importedCategoryCount,
        },
      }
    })()

    for (const feed of importedFeedsToFetch) {
      if (!feed.rss_url && !feed.rss_bridge_url) continue
      fetchSingleFeed(feed).catch(() => {})
    }

    reply.status(201).send({
      user: result.user,
      ...invitationPayload(getOrigin(request), result.token),
      import_result: result.import_result,
    })
  })

  api.patch('/api/users/:id', {
    preHandler: [requireAuth, requireJson, requireRoles(['owner', 'admin'])],
  }, async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const body = parseOrBadRequest(UpdateUserBody, request.body, reply)
    if (!body) return

    const identity = getRequestIdentity(request)
    const target = getUserById(params.id)
    if (!identity?.role || !target) {
      return reply.status(404).send({ error: 'User not found' })
    }

    const denied = assertCanManage(identity.role, target.role)
    if (denied) {
      return reply.status(403).send({ error: denied })
    }
    if (body.role && !roleCanManage(identity.role, body.role as UserRole)) {
      return reply.status(403).send({ error: 'Forbidden' })
    }
    if (body.role === 'owner' && target.role !== 'owner') {
      return reply.status(400).send({ error: 'Ownership transfer is not supported' })
    }
    if (target.role === 'owner' && body.role && body.role !== 'owner') {
      return reply.status(400).send({ error: 'Owner role cannot be changed' })
    }
    if (target.role === 'owner' && body.status === 'disabled') {
      return reply.status(400).send({ error: 'Owner cannot be disabled' })
    }

    const updated = updateUser(params.id, {
      role: body.role,
      status: body.status as UserStatus | undefined,
      github_login: body.github_login === undefined ? undefined : body.github_login,
    })
    if (!updated) {
      return reply.status(404).send({ error: 'User not found' })
    }
    if (body.status === 'disabled') {
      revokeUserSessions(updated.id)
    }
    reply.send({ user: updated })
  })

  api.post('/api/users/:id/invite/reset', {
    preHandler: [requireAuth, requireRoles(['owner', 'admin'])],
  }, async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const identity = getRequestIdentity(request)
    const target = getUserById(params.id)
    if (!identity?.role || !identity.userId || !target) {
      return reply.status(404).send({ error: 'User not found' })
    }

    const denied = assertCanManage(identity.role, target.role)
    if (denied) {
      return reply.status(403).send({ error: denied })
    }

    const invite = issueInvitation(target.id, identity.userId)
    reply.send(invitationPayload(getOrigin(request), invite.token))
  })

  api.post('/api/users/:id/sessions/revoke', {
    preHandler: [requireAuth, requireRoles(['owner', 'admin'])],
  }, async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const identity = getRequestIdentity(request)
    const target = getUserById(params.id)
    if (!identity?.role || !target) {
      return reply.status(404).send({ error: 'User not found' })
    }

    const denied = assertCanManage(identity.role, target.role)
    if (denied) {
      return reply.status(403).send({ error: denied })
    }

    revokeUserSessions(target.id)
    reply.send({ ok: true })
  })
}
