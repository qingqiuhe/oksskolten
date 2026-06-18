import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  createFeed,
  insertArticle,
  createNotificationChannel,
  upsertFeedNotificationRule,
  getNotificationTaskById,
  updateNotificationTaskById,
  getDb,
} from '../db.js'
import { deliverImmediateNotificationsForFeeds, runNotificationChecks } from './runner.js'

const { mockTranslateNotificationBodyText } = vi.hoisted(() => ({
  mockTranslateNotificationBodyText: vi.fn(),
}))

vi.mock('./translation.js', () => ({
  translateNotificationBodyText: (...args: unknown[]) => mockTranslateNotificationBodyText(...args),
}))

describe('runNotificationChecks', () => {
  beforeEach(() => {
    setupTestDb()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockTranslateNotificationBodyText.mockReset().mockResolvedValue(null)
  })

  it('upserts notification rules with returning rows instead of intermediate rule rereads', () => {
    const feed = createFeed({ name: 'Returning Feed', url: 'https://returning.example.com/feed' })
    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/returning',
      secret: null,
      enabled: 1,
    })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const createSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      createSql.push(sql)
      return originalPrepare(sql)
    })

    const rule = upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [channel.id],
    })

    expect(rule.channel_ids).toEqual([channel.id])
    expect(createSql.some(sql => sql.includes('INSERT INTO feed_notification_rules') && sql.includes('RETURNING *'))).toBe(true)
    expect(createSql.some(sql => sql.includes('SELECT * FROM feed_notification_rules WHERE id = ?'))).toBe(false)

    vi.restoreAllMocks()
    mockTranslateNotificationBodyText.mockReset().mockResolvedValue(null)
    const updateSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      updateSql.push(sql)
      return originalPrepare(sql)
    })

    const updated = upsertFeedNotificationRule(feed.id, {
      enabled: false,
      translate_enabled: true,
      check_interval_minutes: 10,
      max_articles_per_message: 3,
      channel_ids: [],
    })

    expect(updated.enabled).toBe(0)
    expect(updated.channel_ids).toEqual([])
    expect(updateSql.some(sql => sql.includes('UPDATE feed_notification_rules') && sql.includes('RETURNING *'))).toBe(true)
    expect(updateSql.some(sql => sql.includes('SELECT * FROM feed_notification_rules WHERE id = ?'))).toBe(false)
  })

  it('prepares changed rule channel binding statements once per upsert', () => {
    const feed = createFeed({ name: 'Binding Feed', url: 'https://bindings.example.com/feed' })
    const channels = Array.from({ length: 5 }, (_, index) => createNotificationChannel({
      type: 'feishu_webhook',
      name: `Channel ${index}`,
      webhook_url: `https://open.feishu.cn/open-apis/bot/v2/hook/binding-${index}`,
      secret: null,
      enabled: 1,
    }))
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: channels.slice(0, 3).map(channel => channel.id),
    })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const updated = upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: channels.slice(2, 5).map(channel => channel.id),
    })

    expect(updated.channel_ids).toEqual(channels.slice(2, 5).map(channel => channel.id))
    const deleteSql = preparedSql.filter(sql => sql.includes('DELETE FROM feed_notification_rule_channels'))
    const insertSql = preparedSql.filter(sql => sql.includes('INSERT INTO feed_notification_rule_channels'))
    expect(deleteSql).toHaveLength(1)
    expect(deleteSql[0]).toContain('channel_id IN (?, ?)')
    expect(insertSql).toHaveLength(1)
    expect(insertSql[0].match(/\(\?, \?, \?, NULL, NULL, datetime\('now'\)\)/g)).toHaveLength(2)
  })

  it('prepares changed task channel binding statements once per task update', () => {
    const feed = createFeed({ name: 'Task Binding Feed', url: 'https://task-bindings.example.com/feed' })
    const channels = Array.from({ length: 5 }, (_, index) => createNotificationChannel({
      type: 'feishu_webhook',
      name: `Task Channel ${index}`,
      webhook_url: `https://open.feishu.cn/open-apis/bot/v2/hook/task-binding-${index}`,
      secret: null,
      enabled: 1,
    }))
    const rule = upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: channels.slice(0, 3).map(channel => channel.id),
    })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const updated = updateNotificationTaskById(rule.id, {
      channel_ids: channels.slice(2, 5).map(channel => channel.id),
    })

    expect(updated?.channel_ids).toEqual(channels.slice(2, 5).map(channel => channel.id))
    expect(preparedSql.filter(sql => sql.includes('SELECT *') && sql.includes('FROM feed_notification_rules') && sql.includes('WHERE id = ?'))).toHaveLength(1)
    expect(preparedSql.some(sql => sql.includes('UPDATE feed_notification_rules') && sql.includes('RETURNING *'))).toBe(true)
    const deleteSql = preparedSql.filter(sql => sql.includes('DELETE FROM feed_notification_rule_channels'))
    const insertSql = preparedSql.filter(sql => sql.includes('INSERT INTO feed_notification_rule_channels'))
    expect(deleteSql).toHaveLength(1)
    expect(deleteSql[0]).toContain('channel_id IN (?, ?)')
    expect(insertSql).toHaveLength(1)
    expect(insertSql[0].match(/\(\?, \?, \?, NULL, NULL, datetime\('now'\)\)/g)).toHaveLength(2)
  })

  it('loads one notification task by id without scanning the full task list', () => {
    const channels = Array.from({ length: 2 }, (_, index) => createNotificationChannel({
      type: 'feishu_webhook',
      name: `Lookup Channel ${index}`,
      webhook_url: `https://open.feishu.cn/open-apis/bot/v2/hook/lookup-${index}`,
      secret: null,
      enabled: 1,
    }))
    const targetFeed = createFeed({ name: 'Lookup Target', url: 'https://lookup-target.example.com/feed' })
    const otherFeed = createFeed({ name: 'Lookup Other', url: 'https://lookup-other.example.com/feed' })
    const targetRule = upsertFeedNotificationRule(targetFeed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: channels.map(channel => channel.id),
    })
    upsertFeedNotificationRule(otherFeed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [],
    })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const task = getNotificationTaskById(targetRule.id)

    expect(task?.id).toBe(targetRule.id)
    expect(task?.channels.map(channel => channel.id)).toEqual(channels.map(channel => channel.id))
    expect(preparedSql.some(sql => sql.includes('WHERE r.id = ?'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('ORDER BY') && sql.includes('lower(f.name)'))).toBe(false)
  })

  it('does not backfill history and only sends newly inserted articles once', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com' })
    insertArticle({
      feed_id: feed.id,
      title: 'Old article',
      url: 'https://example.com/old',
      published_at: '2026-03-30T09:00:00Z',
      full_text: 'Old body',
      notification_body_text: 'Old body',
      notification_media_json: JSON.stringify(['https://cdn.example.com/old.jpg']),
    })

    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [channel.id],
    })

    const freshArticleId = insertArticle({
      feed_id: feed.id,
      title: 'Fresh article',
      url: 'https://example.com/fresh',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'Fresh body',
      notification_body_text: 'Fresh body',
      notification_media_json: JSON.stringify(['https://cdn.example.com/fresh.jpg']),
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { card: { header: { title: { content: string } }; body: { elements: Array<{ text?: { content: string } }> } } }
    expect(payload.card.header.title.content).toBe('Example Feed · 1 条')
    const articleText = payload.card.body.elements.find(element => element.text)?.text?.content ?? ''
    expect(articleText).toContain('Fresh article')
    expect(articleText).toContain('03-31 18:15')
    expect(articleText).not.toContain('发布时间')
    expect(articleText).not.toContain('2026-')
    expect(articleText).not.toContain('Old article')

    const binding = getDb().prepare(`
      SELECT last_notified_article_id, last_error
      FROM feed_notification_rule_channels
      WHERE channel_id = ?
    `).get(channel.id) as { last_notified_article_id: number | null; last_error: string | null }
    expect(binding.last_notified_article_id).toBe(freshArticleId)
    expect(binding.last_error).toBeNull()

    const rule = getDb().prepare(`
      SELECT last_checked_at
      FROM feed_notification_rules
      LIMIT 1
    `).get() as { last_checked_at: string | null }
    expect(rule.last_checked_at).toMatch(/Z$/)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses pending article queries for channels with the same notification cursor', async () => {
    const feed = createFeed({ name: 'Shared Cursor Feed', url: 'https://example.com/shared-cursor' })
    insertArticle({
      feed_id: feed.id,
      title: 'Old article',
      url: 'https://example.com/shared-cursor/old',
      published_at: '2026-03-30T09:00:00Z',
      full_text: 'Old body',
      notification_body_text: 'Old body',
      notification_media_json: null,
    })

    const channels = [0, 1, 2].map(index => createNotificationChannel({
      type: 'feishu_webhook',
      name: `Team ${index}`,
      webhook_url: `https://open.feishu.cn/open-apis/bot/v2/hook/test-token-${index}`,
      secret: null,
      enabled: 1,
    }))
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: channels.map(channel => channel.id),
    })

    insertArticle({
      feed_id: feed.id,
      title: 'Fresh article',
      url: 'https://example.com/shared-cursor/fresh',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'Fresh body',
      notification_body_text: 'Fresh body',
      notification_media_json: null,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    preparedSql.length = 0
    await runNotificationChecks()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(preparedSql.filter(sql => sql.includes('SELECT COUNT(*) AS total, MAX(id) AS max_article_id'))).toHaveLength(1)
    expect(preparedSql.filter(sql => sql.includes('SELECT id, title, url, published_at, fetched_at'))).toHaveLength(1)
    expect(prepareSpy).toHaveBeenCalled()
  })

  it('adds translated body lines when translation is enabled', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com' })
    insertArticle({
      feed_id: feed.id,
      title: 'Old article',
      url: 'https://example.com/old',
      published_at: '2026-03-30T10:15:00Z',
      full_text: 'Old body',
      notification_body_text: 'Old body',
      notification_media_json: null,
    })

    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: true,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [channel.id],
    })

    insertArticle({
      feed_id: feed.id,
      title: 'Fresh article',
      url: 'https://example.com/fresh',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'Fresh body',
      notification_body_text: 'English body',
      notification_media_json: null,
    })

    mockTranslateNotificationBodyText.mockResolvedValue('中文正文')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { card: { body: { elements: Array<{ text?: { content: string } }> } } }
    const articleText = payload.card.body.elements.find(element => element.text)?.text?.content ?? ''
    expect(articleText).toContain('English body')
    expect(articleText).toContain('中文正文')
    expect(mockTranslateNotificationBodyText).toHaveBeenCalledWith('English body', null)
  })

  it('limits notification body translation concurrency', async () => {
    const feed = createFeed({ name: 'Concurrency Feed', url: 'https://example.com/concurrency' })
    insertArticle({
      feed_id: feed.id,
      title: 'Old article',
      url: 'https://example.com/concurrency/old',
      published_at: '2026-03-30T10:15:00Z',
      full_text: 'Old body',
      notification_body_text: 'Old body',
      notification_media_json: null,
    })

    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: true,
      check_interval_minutes: 5,
      max_articles_per_message: 8,
      channel_ids: [channel.id],
    })

    for (let index = 0; index < 8; index += 1) {
      insertArticle({
        feed_id: feed.id,
        title: `Fresh article ${index}`,
        url: `https://example.com/concurrency/${index}`,
        published_at: `2026-03-31T10:${String(index).padStart(2, '0')}:00Z`,
        full_text: `Fresh body ${index}`,
        notification_body_text: `English body ${index}`,
        notification_media_json: null,
      })
    }

    let activeTranslations = 0
    let maxActiveTranslations = 0
    const resolvers: Array<() => void> = []
    mockTranslateNotificationBodyText.mockImplementation(async (body: string) => {
      activeTranslations += 1
      maxActiveTranslations = Math.max(maxActiveTranslations, activeTranslations)
      await new Promise<void>(resolve => resolvers.push(resolve))
      activeTranslations -= 1
      return `中文 ${body}`
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    const runPromise = runNotificationChecks()

    for (let attempts = 0; attempts < 20 && mockTranslateNotificationBodyText.mock.calls.length < 4; attempts += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(mockTranslateNotificationBodyText).toHaveBeenCalledTimes(4)
    expect(maxActiveTranslations).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    for (let attempts = 0; attempts < 20 && mockTranslateNotificationBodyText.mock.calls.length < 8; attempts += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(mockTranslateNotificationBodyText).toHaveBeenCalledTimes(8)
    expect(maxActiveTranslations).toBe(4)

    resolvers.splice(0).forEach(resolve => resolve())
    await runPromise
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to source text when notification translation fails', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com' })
    insertArticle({
      feed_id: feed.id,
      title: 'Old article',
      url: 'https://example.com/old',
      published_at: '2026-03-30T10:15:00Z',
      full_text: 'Old body',
      notification_body_text: 'Old body',
      notification_media_json: null,
    })

    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: true,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [channel.id],
    })

    insertArticle({
      feed_id: feed.id,
      title: 'Fresh article',
      url: 'https://example.com/fresh',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'Fresh body',
      notification_body_text: 'English body',
      notification_media_json: null,
    })

    mockTranslateNotificationBodyText.mockRejectedValue(new Error('translator down'))

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { card: { body: { elements: Array<{ text?: { content: string } }> } } }
    const articleText = payload.card.body.elements.find(element => element.text)?.text?.content ?? ''
    expect(articleText).toContain('English body')
    expect(articleText).not.toContain('中文正文')

    const binding = getDb().prepare(`
      SELECT last_error
      FROM feed_notification_rule_channels
      WHERE channel_id = ?
    `).get(channel.id) as { last_error: string | null }
    expect(binding.last_error).toBeNull()
  })

  it('delivers immediate notifications without waiting for a digest interval', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com' })
    insertArticle({
      feed_id: feed.id,
      title: 'Old article',
      url: 'https://example.com/old',
      published_at: '2026-03-30T09:00:00Z',
      full_text: 'Old body',
      notification_body_text: 'Old body',
      notification_media_json: null,
    })

    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    const rule = upsertFeedNotificationRule(feed.id, {
      enabled: true,
      delivery_mode: 'immediate',
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [channel.id],
    })

    const freshArticleId = insertArticle({
      feed_id: feed.id,
      title: 'Fresh article',
      url: 'https://example.com/fresh',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'Fresh body',
      notification_body_text: 'Fresh body',
      notification_media_json: null,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await deliverImmediateNotificationsForFeeds([feed.id])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const binding = getDb().prepare(`
      SELECT last_notified_article_id, last_error
      FROM feed_notification_rule_channels
      WHERE channel_id = ?
    `).get(channel.id) as { last_notified_article_id: number | null; last_error: string | null }
    expect(binding.last_notified_article_id).toBe(freshArticleId)
    expect(binding.last_error).toBeNull()

    const storedRule = getDb().prepare(`
      SELECT next_check_at, last_checked_at
      FROM feed_notification_rules
      WHERE id = ?
    `).get(rule.id) as { next_check_at: string | null; last_checked_at: string | null }
    expect(storedRule.next_check_at).toBeNull()
    expect(storedRule.last_checked_at).not.toBeNull()
  })

  it('retries failed immediate notifications on the shared due-rule pass', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com' })
    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    const rule = upsertFeedNotificationRule(feed.id, {
      enabled: true,
      delivery_mode: 'immediate',
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [channel.id],
    })

    const freshArticleId = insertArticle({
      feed_id: feed.id,
      title: 'Fresh article',
      url: 'https://example.com/fresh',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'Fresh body',
      notification_body_text: 'Fresh body',
      notification_media_json: null,
    })

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('webhook down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, msg: 'success' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await deliverImmediateNotificationsForFeeds([feed.id])

    const failedRule = getDb().prepare(`
      SELECT next_check_at
      FROM feed_notification_rules
      WHERE id = ?
    `).get(rule.id) as { next_check_at: string | null }
    expect(failedRule.next_check_at).not.toBeNull()

    const failedBinding = getDb().prepare(`
      SELECT last_notified_article_id, last_error
      FROM feed_notification_rule_channels
      WHERE channel_id = ?
    `).get(channel.id) as { last_notified_article_id: number | null; last_error: string | null }
    expect(failedBinding.last_notified_article_id).toBeNull()
    expect(failedBinding.last_error).toContain('webhook down')

    getDb().prepare(`
      UPDATE feed_notification_rules
      SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')
      WHERE id = ?
    `).run(rule.id)

    await runNotificationChecks()

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const recoveredBinding = getDb().prepare(`
      SELECT last_notified_article_id, last_error
      FROM feed_notification_rule_channels
      WHERE channel_id = ?
    `).get(channel.id) as { last_notified_article_id: number | null; last_error: string | null }
    expect(recoveredBinding.last_notified_article_id).toBe(freshArticleId)
    expect(recoveredBinding.last_error).toBeNull()

    const recoveredRule = getDb().prepare(`
      SELECT next_check_at
      FROM feed_notification_rules
      WHERE id = ?
    `).get(rule.id) as { next_check_at: string | null }
    expect(recoveredRule.next_check_at).toBeNull()
  })

  it('omits body, translation, and images in title-only mode', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com/title-only' })
    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      content_mode: 'title_only',
      translate_enabled: true,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      channel_ids: [channel.id],
    })

    insertArticle({
      feed_id: feed.id,
      title: 'Fresh article',
      url: 'https://example.com/fresh-title-only',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'Fresh body',
      notification_body_text: 'English body',
      notification_media_json: JSON.stringify(['https://cdn.example.com/fresh.jpg']),
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { card: { body: { elements: Array<{ text?: { content: string } }> } } }
    const articleText = payload.card.body.elements.find(element => element.text)?.text?.content ?? ''
    expect(articleText).toContain('Fresh article')
    expect(articleText).not.toContain('English body')
    expect(articleText).not.toContain('![](')
    expect(mockTranslateNotificationBodyText).not.toHaveBeenCalled()
  })

  it('respects per-rule max articles and keeps the rest count', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com/limit' })
    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 5,
      max_articles_per_message: 2,
      channel_ids: [channel.id],
    })

    insertArticle({
      feed_id: feed.id,
      title: 'Article A',
      url: 'https://example.com/a',
      published_at: '2026-03-31T10:15:00Z',
      full_text: 'A body',
      notification_body_text: 'A body',
      notification_media_json: null,
    })
    insertArticle({
      feed_id: feed.id,
      title: 'Article B',
      url: 'https://example.com/b',
      published_at: '2026-03-31T10:16:00Z',
      full_text: 'B body',
      notification_body_text: 'B body',
      notification_media_json: null,
    })
    insertArticle({
      feed_id: feed.id,
      title: 'Article C',
      url: 'https://example.com/c',
      published_at: '2026-03-31T10:17:00Z',
      full_text: 'C body',
      notification_body_text: 'C body',
      notification_media_json: null,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { card: { body: { elements: Array<{ text?: { content: string } }> } } }
    const textBlocks = payload.card.body.elements.map(element => element.text?.content ?? '').join('\n')
    expect(textBlocks).toContain('Article C')
    expect(textBlocks).toContain('Article B')
    expect(textBlocks).not.toContain('Article A')
    expect(textBlocks).toContain('另外 1 篇')
  })

  it('truncates titles and body text with per-rule character limits', async () => {
    const feed = createFeed({ name: 'Example Feed', url: 'https://example.com/truncate' })
    const channel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      secret: null,
      enabled: 1,
    })
    upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: true,
      check_interval_minutes: 5,
      max_articles_per_message: 5,
      max_title_chars: 5,
      max_body_chars: 5,
      channel_ids: [channel.id],
    })

    insertArticle({
      feed_id: feed.id,
      title: '123456789',
      url: 'https://example.com/truncated',
      published_at: '2026-03-31T10:17:00Z',
      full_text: 'ABCDEFGHIJK',
      notification_body_text: 'ABCDEFGHIJK',
      notification_media_json: null,
    })

    mockTranslateNotificationBodyText.mockResolvedValue('中文翻译测试')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'success' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { card: { body: { elements: Array<{ text?: { content: string } }> } } }
    const articleText = payload.card.body.elements.find(element => element.text)?.text?.content ?? ''
    expect(articleText).toContain('1234…')
    expect(articleText).not.toContain('123456789')
    expect(articleText).toContain('ABCD…')
    expect(articleText).not.toContain('ABCDEFGHIJK')
    expect(articleText).toContain('中文翻译…')
    expect(mockTranslateNotificationBodyText).toHaveBeenCalledWith('ABCD…', null)
  })
})
