import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  createFeed,
  insertArticle,
  createNotificationChannel,
  upsertFeedNotificationRule,
  getDb,
} from '../db.js'
import { runNotificationChecks } from './runner.js'

describe('runNotificationChecks', () => {
  beforeEach(() => {
    setupTestDb()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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
})
