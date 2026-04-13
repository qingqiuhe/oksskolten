import type { FastifyInstance } from 'fastify'
import type { Feed, FeedPriorityLevel } from '../../shared/types.js'
import { z } from 'zod'
import { startSSE } from '../lib/sse.js'
import { logger } from '../logger.js'

const log = logger.child('api')
import {
  getFeeds,
  getFeedById,
  getFeedByUrl,
  createFeed,
  updateFeed,
  getFeedSourceConfig,
  updateFeedSourceConfig,
  deleteFeed,
  bulkMoveFeedsToCategory,
  markAllSeenByFeed,
  getBookmarkCount,
  getLikeCount,
  getClipFeed,
  getFeedMetrics,
  getCategories,
  createCategory,
  getFeedNotificationRule,
  upsertFeedNotificationRule,
  deleteFeedNotificationRule,
  listNotificationChannels,
} from '../db.js'
import { requireJson, getRequestUserId, requireRoles } from '../auth.js'
import { fetchSingleFeed, discoverRssUrl } from '../fetcher.js'
import {
  fetchAndTransformJsonApiFeed,
  inferJsonApiViewType,
  parseJsonApiSourceConfig,
  stringifyJsonApiSourceConfig,
} from '../fetcher/json-api.js'
import { queryRssBridge, inferCssSelectorBridge } from '../rss-bridge.js'
import { parseOpml, generateOpml } from '../opml.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'
import {
  DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES,
  DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
  DEFAULT_NOTIFICATION_MAX_BODY_CHARS,
  DEFAULT_NOTIFICATION_MAX_TITLE_CHARS,
  MAX_NOTIFICATION_CHECK_INTERVAL_MINUTES,
  MAX_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
  MAX_NOTIFICATION_MAX_BODY_CHARS,
  MAX_NOTIFICATION_MAX_TITLE_CHARS,
  MIN_NOTIFICATION_CHECK_INTERVAL_MINUTES,
  MIN_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
  MIN_NOTIFICATION_MAX_BODY_CHARS,
  MIN_NOTIFICATION_MAX_TITLE_CHARS,
} from '../../shared/notification-message.js'

const httpsUrl = z
  .string({ error: 'url is required' })
  .min(1, 'url is required')
  .url('must be a valid URL')
  .refine((u) => u.startsWith('https://'), { message: 'Only https:// URLs are allowed' })

const optionalHttpsUrl = httpsUrl.nullable().optional()

const DiscoverTitleQuery = z.object({
  url: httpsUrl,
})

const optionalPriorityLevel = z
  .number()
  .int()
  .refine((value): value is FeedPriorityLevel => value >= 1 && value <= 5, {
    message: 'priority_level must be between 1 and 5',
  })
  .optional()

const CreateFeedBody = z.object({
  url: httpsUrl,
  name: z.string().optional(),
  icon_url: optionalHttpsUrl,
  category_id: z.number().nullable().optional(),
  feed_priority: optionalPriorityLevel,
  priority_level: optionalPriorityLevel,
})

const UpdateFeedBody = z.object({
  name: z.string().optional(),
  icon_url: optionalHttpsUrl,
  rss_bridge_url: z.string().nullable().optional(),
  view_type: z.enum(['article', 'social']).nullable().optional(),
  disabled: z.number().optional(),
  category_id: z.number().nullable().optional(),
  feed_priority: optionalPriorityLevel,
  priority_level: optionalPriorityLevel,
})
const transformScript = z
  .string()
  .min(1, 'transform_script is required')
  .max(16_384, 'transform_script is too large')

const JsonApiFeedBody = z.object({
  url: httpsUrl,
  name: z.string().optional(),
  icon_url: optionalHttpsUrl,
  category_id: z.number().nullable().optional(),
  feed_priority: optionalPriorityLevel,
  priority_level: optionalPriorityLevel,
  view_type: z.enum(['article', 'social']).nullable().optional(),
  transform_script: transformScript,
})

const UpdateJsonApiConfigBody = z.object({
  transform_script: transformScript,
})
const FeedNotificationRuleBody = z.object({
  enabled: z.boolean(),
  delivery_mode: z.enum(['immediate', 'digest']).optional(),
  content_mode: z.enum(['title_only', 'title_and_body']).optional(),
  translate_enabled: z.boolean(),
  check_interval_minutes: z.number().int().min(MIN_NOTIFICATION_CHECK_INTERVAL_MINUTES).max(MAX_NOTIFICATION_CHECK_INTERVAL_MINUTES).optional(),
  max_articles_per_message: z.number().int().min(MIN_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE).max(MAX_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE).optional(),
  max_title_chars: z.number().int().min(MIN_NOTIFICATION_MAX_TITLE_CHARS).max(MAX_NOTIFICATION_MAX_TITLE_CHARS).optional(),
  max_body_chars: z.number().int().min(MIN_NOTIFICATION_MAX_BODY_CHARS).max(MAX_NOTIFICATION_MAX_BODY_CHARS).optional(),
  channel_ids: z.array(z.number().int()).max(32),
})

function toPublicFeed<T extends object>(feed: T): T {
  const copy = { ...feed } as T & { source_config_json?: unknown }
  delete copy.source_config_json
  return copy
}

export async function feedRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/feeds', async (request, reply) => {
    const userId = getRequestUserId(request)
    const feeds = getFeeds(userId)
    const bookmark_count = getBookmarkCount(userId)
    const like_count = getLikeCount(userId)
    const clipFeed = getClipFeed(userId)
    const clip_feed_id = clipFeed?.id ?? null
    reply.send({ feeds: feeds.map(toPublicFeed), bookmark_count, like_count, clip_feed_id })
  })

  api.get('/api/discover-title', async (request, reply) => {
    const query = parseOrBadRequest(DiscoverTitleQuery, request.query, reply)
    if (!query) return
    try {
      const { title } = await discoverRssUrl(query.url)
      reply.send({ title })
    } catch {
      reply.send({ title: null })
    }
  })

  api.post(
    '/api/feeds/json-api/preview',
    {
      preHandler: [requireJson, requireRoles(['owner', 'admin'])],
    },
    async (request, reply) => {
      const body = parseOrBadRequest(JsonApiFeedBody, request.body, reply)
      if (!body) return

      try {
        const result = await fetchAndTransformJsonApiFeed({
          endpointUrl: body.url,
          transformScript: body.transform_script,
          skipCache: true,
        })
        const inferredViewType = body.view_type ?? result.meta.view_type ?? inferJsonApiViewType(result.items)
        const resolvedFeed = {
          name: body.name || result.meta.title || new URL(body.url).hostname,
          icon_url: body.icon_url ?? result.meta.icon_url,
          view_type: inferredViewType,
        }

        reply.send({
          resolved_feed: resolvedFeed,
          sample_items: result.items.slice(0, 5),
          warnings: result.warnings,
          stats: {
            received_count: result.receivedCount,
            accepted_count: result.items.length,
            dropped_count: result.receivedCount - result.items.length,
          },
        })
      } catch (err) {
        reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid JSON API feed' })
      }
    },
  )

  api.post(
    '/api/feeds/json-api',
    {
      preHandler: [requireJson, requireRoles(['owner', 'admin'])],
    },
    async (request, reply) => {
      const body = parseOrBadRequest(JsonApiFeedBody, request.body, reply)
      if (!body) return
      const userId = getRequestUserId(request)

      if (getFeedByUrl(body.url, userId)) {
        reply.status(409).send({ error: 'Feed URL already exists' })
        return
      }

      try {
        const result = await fetchAndTransformJsonApiFeed({
          endpointUrl: body.url,
          transformScript: body.transform_script,
          skipCache: true,
        })
        const resolvedViewType = body.view_type ?? result.meta.view_type ?? inferJsonApiViewType(result.items)
        const feed = createFeed({
          name: body.name || result.meta.title || new URL(body.url).hostname,
          url: body.url,
          icon_url: body.icon_url ?? result.meta.icon_url,
          category_id: body.category_id ?? null,
          priority_level: body.priority_level ?? body.feed_priority,
          view_type: resolvedViewType,
          type: 'rss',
          ingest_kind: 'json_api',
          source_config_json: stringifyJsonApiSourceConfig({
            version: 1,
            transform_script: body.transform_script,
          }),
        }, userId)

        fetchSingleFeed(feed).catch(err => {
          log.error(`Initial JSON API fetch for ${feed.name} failed:`, err)
        })

        reply.status(201).send({ feed: toPublicFeed(feed), warnings: result.warnings })
      } catch (err) {
        reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid JSON API feed' })
      }
    },
  )

  api.get(
    '/api/feeds/:id/json-api-config',
    { preHandler: [requireRoles(['owner', 'admin'])] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const userId = getRequestUserId(request)
      const feed = getFeedById(params.id, userId)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      if (feed.ingest_kind !== 'json_api') {
        reply.status(400).send({ error: 'Feed is not a JSON API feed' })
        return
      }

      const sourceConfig = parseJsonApiSourceConfig(getFeedSourceConfig(params.id, userId))
      if (!sourceConfig) {
        reply.status(500).send({ error: 'Feed source config is missing or invalid' })
        return
      }

      reply.send({ transform_script: sourceConfig.transform_script })
    },
  )

  api.put(
    '/api/feeds/:id/json-api-config',
    { preHandler: [requireJson, requireRoles(['owner', 'admin'])] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(UpdateJsonApiConfigBody, request.body, reply)
      if (!body) return
      const userId = getRequestUserId(request)
      const feed = getFeedById(params.id, userId)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      if (feed.ingest_kind !== 'json_api') {
        reply.status(400).send({ error: 'Feed is not a JSON API feed' })
        return
      }

      try {
        await fetchAndTransformJsonApiFeed({
          endpointUrl: feed.url,
          transformScript: body.transform_script,
          skipCache: true,
        })
      } catch (err) {
        reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid JSON API feed' })
        return
      }

      updateFeedSourceConfig(params.id, stringifyJsonApiSourceConfig({
        version: 1,
        transform_script: body.transform_script,
      }), userId)

      reply.send({ transform_script: body.transform_script })
    },
  )

  api.post(
    '/api/feeds',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(CreateFeedBody, request.body, reply)
      if (!body) return
      const userId = getRequestUserId(request)

      if (getFeedByUrl(body.url, userId)) {
        reply.status(409).send({ error: 'Feed URL already exists' })
        return
      }

      // --- SSE starts here ---
      const sse = startSSE(reply)
      const send = sse.send

      try {
        let rssUrl: string | null = null
        let rssBridgeUrl: string | null = null
        let discoveredTitle: string | null = null
        let discoveredIconUrl: string | null = null
        let requiresJsChallenge = false

        // Step 1: RSS auto-discovery
        send({ type: 'step', step: 'rss-discovery', status: 'running' })
        try {
          const result = await discoverRssUrl(body.url, {
            onFlareSolverr: (status, found) => {
              send({ type: 'step', step: 'flaresolverr', status: status === 'running' ? 'running' : 'done', found })
            },
          })
          rssUrl = result.rssUrl
          discoveredTitle = result.title
          discoveredIconUrl = result.iconUrl
          if (result.usedFlareSolverr) requiresJsChallenge = true
          send({ type: 'step', step: 'rss-discovery', status: 'done', found: !!rssUrl })
        } catch {
          send({ type: 'step', step: 'rss-discovery', status: 'done', found: false })
        }

        // Step 2: RSS Bridge fallback
        if (!rssUrl) {
          send({ type: 'step', step: 'rss-bridge', status: 'running' })
          rssBridgeUrl = await queryRssBridge(body.url)
          send({ type: 'step', step: 'rss-bridge', status: 'done', found: !!rssBridgeUrl })
        } else {
          send({ type: 'step', step: 'rss-bridge', status: 'skipped' })
        }

        // Step 3: CssSelectorBridge via LLM
        if (!rssUrl && !rssBridgeUrl) {
          send({ type: 'step', step: 'css-selector', status: 'running' })
          rssBridgeUrl = await inferCssSelectorBridge(body.url)
          send({ type: 'step', step: 'css-selector', status: 'done', found: !!rssBridgeUrl })
        } else {
          send({ type: 'step', step: 'css-selector', status: 'skipped' })
        }

        // If every strategy failed, do not create a feed.
        if (!rssUrl && !rssBridgeUrl) {
          send({ type: 'error', error: 'RSS could not be detected for this URL' })
          sse.end()
          return
        }

        const feedName = body.name || discoveredTitle || new URL(body.url).hostname

        const feed = createFeed({
          name: feedName,
          url: body.url,
          icon_url: body.icon_url ?? discoveredIconUrl,
          rss_url: rssUrl,
          rss_bridge_url: rssBridgeUrl,
          category_id: body.category_id ?? null,
          priority_level: body.priority_level ?? body.feed_priority,
          requires_js_challenge: requiresJsChallenge ? 1 : 0,
        }, userId)

        // Fire-and-forget: fetch articles for the new feed
        if (feed.rss_url || feed.rss_bridge_url) {
          fetchSingleFeed(feed).catch(err => {
            log.error(`Initial fetch for ${feed.name} failed:`, err)
          })
        }

        send({ type: 'done', feed: toPublicFeed(feed) })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      }

      sse.end()
    },
  )

  api.patch(
    '/api/feeds/:id',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(UpdateFeedBody, request.body, reply)
      if (!body) return
      const userId = getRequestUserId(request)

      const feed = updateFeed(params.id, {
        ...body,
        priority_level: body.priority_level ?? body.feed_priority,
      }, userId)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }

      const feeds = getFeeds(userId)
      const withCounts = feeds.find(f => f.id === feed.id)
      reply.send(toPublicFeed(withCounts || feed))
    },
  )

  api.get('/api/feeds/:id/notification-rule', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const userId = getRequestUserId(request)
    const feed = getFeedById(params.id, userId)
    if (!feed) {
      reply.status(404).send({ error: 'Feed not found' })
      return
    }

    const rule = getFeedNotificationRule(params.id, userId)
    reply.send(rule ?? {
      id: null,
      user_id: userId,
      feed_id: params.id,
      enabled: 0,
      delivery_mode: 'immediate',
      content_mode: 'title_and_body',
      translate_enabled: 0,
      check_interval_minutes: DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES,
      max_articles_per_message: DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
      max_title_chars: DEFAULT_NOTIFICATION_MAX_TITLE_CHARS,
      max_body_chars: DEFAULT_NOTIFICATION_MAX_BODY_CHARS,
      next_check_at: null,
      last_checked_at: null,
      created_at: null,
      updated_at: null,
      channel_ids: [],
    })
  })

  api.put(
    '/api/feeds/:id/notification-rule',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const body = parseOrBadRequest(FeedNotificationRuleBody, request.body, reply)
      if (!body) return

      const userId = getRequestUserId(request)
      const feed = getFeedById(params.id, userId)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }

      const availableChannels = new Map(
        listNotificationChannels(userId)
          .filter(channel => channel.enabled === 1)
          .map(channel => [channel.id, channel]),
      )

      if (body.enabled && body.channel_ids.length === 0) {
        reply.status(400).send({ error: 'channel_ids must not be empty when notifications are enabled' })
        return
      }
      if ((body.delivery_mode ?? 'immediate') === 'digest' && body.check_interval_minutes == null) {
        reply.status(400).send({ error: 'check_interval_minutes is required for digest mode' })
        return
      }

      for (const channelId of body.channel_ids) {
        if (!availableChannels.has(channelId)) {
          reply.status(400).send({ error: `Invalid notification channel: ${channelId}` })
          return
        }
      }

      const rule = upsertFeedNotificationRule(params.id, {
        ...body,
        delivery_mode: body.delivery_mode ?? 'immediate',
      }, userId)
      reply.send(rule)
    },
  )

  api.delete('/api/feeds/:id/notification-rule', async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const userId = getRequestUserId(request)
    const feed = getFeedById(params.id, userId)
    if (!feed) {
      reply.status(404).send({ error: 'Feed not found' })
      return
    }
    deleteFeedNotificationRule(params.id, userId)
    reply.status(204).send()
  })

  const BulkMoveBody = z.object({
    feed_ids: z.array(z.number()).min(1, 'feed_ids must not be empty'),
    category_id: z.number().nullable(),
  })

  api.post(
    '/api/feeds/bulk-move',
    { preHandler: [requireJson] },
    async (request, reply) => {
      const body = parseOrBadRequest(BulkMoveBody, request.body, reply)
      if (!body) return
      bulkMoveFeedsToCategory(body.feed_ids, body.category_id)
      reply.status(204).send()
    },
  )

  api.delete(
    '/api/feeds/:id',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const userId = getRequestUserId(request)
      const feed = getFeedById(params.id, userId)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      if (feed.type === 'clip') {
        reply.status(403).send({ error: 'Cannot delete the clip feed' })
        return
      }
      const deleted = deleteFeed(params.id, userId)
      if (!deleted) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      reply.status(204).send()
    },
  )

  // --- Single feed fetch (SSE) ---

  api.post(
    '/api/feeds/:id/fetch',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const userId = getRequestUserId(request)
      const feed = getFeedById(params.id, userId)
      if (!feed || feed.disabled) {
        reply.status(404).send({ error: 'Feed not found or disabled' })
        return
      }

      const sse = startSSE(reply)

      await fetchSingleFeed(feed, (event) => {
        sse.send(event)
      }, { skipCache: true })

      sse.end()
    },
  )

  // --- RSS re-detection ---

  api.post(
    '/api/feeds/:id/re-detect',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const userId = getRequestUserId(request)
      const feed = getFeedById(params.id, userId)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      if (feed.ingest_kind === 'json_api') {
        reply.status(400).send({ error: 'JSON API feeds do not support re-detect' })
        return
      }

      const sse = startSSE(reply)

      let rssUrl: string | null = null
      let rssBridgeUrl: string | null = null
      let iconUrl: string | null = null

      // Step 1: RSS auto-discovery
      sse.send({ type: 'stage', stage: 'discovery' })
      try {
        const result = await discoverRssUrl(feed.url)
        rssUrl = result.rssUrl
        iconUrl = result.iconUrl
      } catch {
        // Discovery failed
      }
      sse.send({ type: 'stage-done', stage: 'discovery', found: !!rssUrl })

      // Step 2: RSS Bridge fallback
      if (!rssUrl) {
        sse.send({ type: 'stage', stage: 'bridge' })
        rssBridgeUrl = await queryRssBridge(feed.url)
        sse.send({ type: 'stage-done', stage: 'bridge', found: !!rssBridgeUrl })
      }

      // Step 3: CssSelectorBridge via LLM
      if (!rssUrl && !rssBridgeUrl) {
        sse.send({ type: 'stage', stage: 'bridge-llm' })
        rssBridgeUrl = await inferCssSelectorBridge(feed.url)
        sse.send({ type: 'stage-done', stage: 'bridge-llm', found: !!rssBridgeUrl })
      }

      // Update feed with new URLs
      updateFeed(params.id, {
        icon_url: iconUrl,
        rss_url: rssUrl,
        rss_bridge_url: rssBridgeUrl,
      }, userId)

      // Fire-and-forget: fetch articles with updated config
      const refreshedFeed = getFeedById(params.id, userId)
      if (refreshedFeed && (rssUrl || rssBridgeUrl)) {
        fetchSingleFeed(refreshedFeed).catch(err => {
          log.error(`Re-detect fetch for ${refreshedFeed.name} failed:`, err)
        })
      }

      sse.send({ type: 'done', rss_url: rssUrl, rss_bridge_url: rssBridgeUrl, icon_url: iconUrl })
      sse.end()
    },
  )

  api.get(
    '/api/feeds/:id/metrics',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const userId = getRequestUserId(request)
      const feed = getFeedById(params.id, userId)
      if (!feed) {
        reply.status(404).send({ error: 'Feed not found' })
        return
      }
      const metrics = getFeedMetrics(params.id, userId)
      reply.send(metrics ?? { avg_content_length: null })
    },
  )

  api.post(
    '/api/feeds/:id/mark-all-seen',
    async (request, reply) => {
      const params = parseOrBadRequest(NumericIdParams, request.params, reply)
      if (!params) return
      const userId = getRequestUserId(request)
      const result = markAllSeenByFeed(params.id, userId)
      reply.send(result)
    },
  )

  // --- OPML export ---

  api.get('/api/opml', async (request, reply) => {
    const userId = getRequestUserId(request)
    const feeds = getFeeds(userId)
    const categories = getCategories(userId)
    const xml = generateOpml(feeds, categories)
    reply
      .header('Content-Type', 'application/xml')
      .header('Content-Disposition', 'attachment; filename="oksskolten.opml"')
      .send(xml)
  })

  // --- OPML preview ---

  api.post('/api/opml/preview', async (request, reply) => {
    const file = await request.file()
    if (!file) {
      reply.status(400).send({ error: 'No file uploaded' })
      return
    }

    const buffer = await file.toBuffer()
    const xml = buffer.toString('utf-8')

    let parsed
    try {
      parsed = parseOpml(xml)
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid OPML' })
      return
    }

    const userId = getRequestUserId(request)
    const feeds = parsed.map((entry) => {
      const existing = getFeedByUrl(entry.url, userId)
      return {
        name: entry.name,
        url: entry.url,
        rssUrl: entry.rssUrl,
        categoryName: entry.categoryName,
        isDuplicate: !!existing,
      }
    })

    reply.send({
      feeds,
      totalCount: feeds.length,
      duplicateCount: feeds.filter((f) => f.isDuplicate).length,
    })
  })

  // --- OPML import ---

  api.post('/api/opml', async (request, reply) => {
    const file = await request.file()
    if (!file) {
      reply.status(400).send({ error: 'No file uploaded' })
      return
    }

    const buffer = await file.toBuffer()
    const xml = buffer.toString('utf-8')

    let parsed
    try {
      parsed = parseOpml(xml)
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : 'Invalid OPML' })
      return
    }

    // Filter by selectedUrls if provided
    const selectedUrlsRaw = file.fields?.selectedUrls
    let selectedUrlSet: Set<string> | null = null
    if (selectedUrlsRaw && typeof selectedUrlsRaw === 'object' && 'value' in selectedUrlsRaw) {
      const urls: string[] = JSON.parse((selectedUrlsRaw as { value: string }).value)
      selectedUrlSet = new Set(urls)
    }

    const entries = selectedUrlSet
      ? parsed.filter((entry) => selectedUrlSet!.has(entry.url))
      : parsed

    let imported = 0
    let skipped = 0
    const errors: string[] = []
    const importedFeeds: Feed[] = []

    const importUserId = getRequestUserId(request)
    // Pre-fetch existing categories
    const existingCategories = getCategories(importUserId)
    const categoryByName = new Map(existingCategories.map(c => [c.name.toLowerCase(), c]))

    for (const entry of entries) {
      try {
        // Check for duplicate by url or rss_url
        if (getFeedByUrl(entry.url, importUserId)) {
          skipped++
          continue
        }

        // Resolve category
        let categoryId: number | null = null
        if (entry.categoryName) {
          const existing = categoryByName.get(entry.categoryName.toLowerCase())
          if (existing) {
            categoryId = existing.id
          } else {
            const created = createCategory(entry.categoryName, importUserId)
            categoryByName.set(entry.categoryName.toLowerCase(), created)
            categoryId = created.id
          }
        }

        const feed = createFeed({
          name: entry.name,
          url: entry.url,
          rss_url: entry.rssUrl,
          category_id: categoryId,
        }, importUserId)
        importedFeeds.push(feed)
        imported++
      } catch (err) {
        errors.push(`${entry.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Fire-and-forget: fetch articles for newly imported feeds
    for (const feed of importedFeeds) {
      if (feed.rss_url) {
        fetchSingleFeed(feed).catch(err => {
          log.error(`OPML: Initial fetch for ${feed.name} failed:`, err)
        })
      }
    }

    reply.send({ imported, skipped, errors })
  })
}
