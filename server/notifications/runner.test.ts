import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  createFeed,
  insertArticle,
  createNotificationChannel,
  upsertFeedNotificationRule,
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
    expect(articleText).not.toContain('Old article')

    const binding = getDb().prepare(`
      SELECT last_notified_article_id, last_error
      FROM feed_notification_rule_channels
      WHERE channel_id = ?
    `).get(channel.id) as { last_notified_article_id: number | null; last_error: string | null }
    expect(binding.last_notified_article_id).toBe(freshArticleId)
    expect(binding.last_error).toBeNull()

    getDb().prepare(`UPDATE feed_notification_rules SET next_check_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 minute')`).run()
    await runNotificationChecks()
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
})
