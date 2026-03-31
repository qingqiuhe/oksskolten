import { getDb, runNamed } from './connection.js'
import { getCurrentUserId } from '../identity.js'

function resolveUserId(userId?: number | null): number | null {
  return userId ?? getCurrentUserId()
}

export interface NotificationChannel {
  id: number
  user_id: number | null
  type: 'feishu_webhook'
  name: string
  webhook_url: string
  secret: string | null
  enabled: number
  created_at: string
  updated_at: string
}

export interface FeedNotificationRule {
  id: number
  user_id: number | null
  feed_id: number
  enabled: number
  check_interval_minutes: number
  next_check_at: string | null
  last_checked_at: string | null
  created_at: string
  updated_at: string
}

export interface FeedNotificationRuleRecord extends FeedNotificationRule {
  channel_ids: number[]
}

export interface FeedNotificationBinding {
  rule_id: number
  channel_id: number
  last_notified_article_id: number | null
  last_notified_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface DueNotificationRule extends FeedNotificationRule {
  feed_name: string
}

export interface NotificationArticleRecord {
  id: number
  title: string
  url: string
  published_at: string | null
  fetched_at: string
  notification_body_text: string | null
  notification_media_json: string | null
}

function scopeWhere(column: string, userId: number | null): { clause: string; params: unknown[] } {
  return userId == null
    ? { clause: `${column} IS NULL`, params: [] }
    : { clause: `${column} = ?`, params: [userId] }
}

function toIsoNoMillis(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function nextCheckAtFromMinutes(minutes: number): string {
  return toIsoNoMillis(new Date(Date.now() + minutes * 60_000))
}

export function listNotificationChannels(userId?: number | null): NotificationChannel[] {
  const scopedUserId = resolveUserId(userId)
  const scope = scopeWhere('user_id', scopedUserId)
  return getDb().prepare(`
    SELECT *
    FROM notification_channels
    WHERE ${scope.clause}
    ORDER BY created_at DESC, id DESC
  `).all(...scope.params) as NotificationChannel[]
}

export function getNotificationChannelById(id: number, userId?: number | null): NotificationChannel | undefined {
  const scopedUserId = resolveUserId(userId)
  const scope = scopeWhere('user_id', scopedUserId)
  return getDb().prepare(`
    SELECT *
    FROM notification_channels
    WHERE id = ?
      AND ${scope.clause}
  `).get(id, ...scope.params) as NotificationChannel | undefined
}

export function createNotificationChannel(
  data: Pick<NotificationChannel, 'name' | 'type' | 'webhook_url' | 'secret' | 'enabled'>,
  userId?: number | null,
): NotificationChannel {
  const scopedUserId = resolveUserId(userId)
  const result = runNamed(`
    INSERT INTO notification_channels (user_id, type, name, webhook_url, secret, enabled)
    VALUES (@user_id, @type, @name, @webhook_url, @secret, @enabled)
  `, {
    user_id: scopedUserId,
    type: data.type,
    name: data.name,
    webhook_url: data.webhook_url,
    secret: data.secret,
    enabled: data.enabled,
  })

  return getDb().prepare('SELECT * FROM notification_channels WHERE id = ?').get(result.lastInsertRowid) as NotificationChannel
}

export function updateNotificationChannel(
  id: number,
  data: Partial<Pick<NotificationChannel, 'name' | 'webhook_url' | 'secret' | 'enabled'>>,
  userId?: number | null,
): NotificationChannel | undefined {
  const existing = getNotificationChannelById(id, userId)
  if (!existing) return undefined

  const fields: string[] = ['updated_at = datetime(\'now\')']
  const params: Record<string, unknown> = { id }

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    fields.push(`${key} = @${key}`)
    params[key] = value
  }

  if (fields.length === 1) return existing

  const scopedUserId = resolveUserId(userId)
  if (scopedUserId == null) {
    runNamed(`UPDATE notification_channels SET ${fields.join(', ')} WHERE id = @id AND user_id IS NULL`, params)
  } else {
    runNamed(`UPDATE notification_channels SET ${fields.join(', ')} WHERE id = @id AND user_id = @user_id`, {
      ...params,
      user_id: scopedUserId,
    })
  }

  return getDb().prepare('SELECT * FROM notification_channels WHERE id = ?').get(id) as NotificationChannel
}

export function deleteNotificationChannel(id: number, userId?: number | null): boolean {
  const scopedUserId = resolveUserId(userId)
  const result = scopedUserId == null
    ? getDb().prepare('DELETE FROM notification_channels WHERE id = ? AND user_id IS NULL').run(id)
    : getDb().prepare('DELETE FROM notification_channels WHERE id = ? AND user_id = ?').run(id, scopedUserId)
  return result.changes > 0
}

function latestFeedArticleId(feedId: number): number | null {
  const row = getDb().prepare(`
    SELECT id
    FROM articles
    WHERE feed_id = ?
      AND purged_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `).get(feedId) as { id: number } | undefined
  return row?.id ?? null
}

export function getFeedNotificationRule(feedId: number, userId?: number | null): FeedNotificationRuleRecord | null {
  const scopedUserId = resolveUserId(userId)
  const scope = scopeWhere('user_id', scopedUserId)
  const rule = getDb().prepare(`
    SELECT *
    FROM feed_notification_rules
    WHERE feed_id = ?
      AND ${scope.clause}
  `).get(feedId, ...scope.params) as FeedNotificationRule | undefined

  if (!rule) return null
  const rows = getDb().prepare(`
    SELECT channel_id
    FROM feed_notification_rule_channels
    WHERE rule_id = ?
    ORDER BY channel_id
  `).all(rule.id) as Array<{ channel_id: number }>

  return { ...rule, channel_ids: rows.map(row => row.channel_id) }
}

export function upsertFeedNotificationRule(
  feedId: number,
  data: { enabled: boolean; check_interval_minutes: number; channel_ids: number[] },
  userId?: number | null,
): FeedNotificationRuleRecord {
  const scopedUserId = resolveUserId(userId)
  const nextCheckAt = data.enabled ? nextCheckAtFromMinutes(data.check_interval_minutes) : null

  return getDb().transaction(() => {
    let rule = getFeedNotificationRule(feedId, scopedUserId)
    if (!rule) {
      const result = runNamed(`
        INSERT INTO feed_notification_rules (user_id, feed_id, enabled, check_interval_minutes, next_check_at)
        VALUES (@user_id, @feed_id, @enabled, @check_interval_minutes, @next_check_at)
      `, {
        user_id: scopedUserId,
        feed_id: feedId,
        enabled: data.enabled ? 1 : 0,
        check_interval_minutes: data.check_interval_minutes,
        next_check_at: nextCheckAt,
      })
      rule = {
        ...(getDb().prepare('SELECT * FROM feed_notification_rules WHERE id = ?').get(result.lastInsertRowid) as FeedNotificationRule),
        channel_ids: [],
      }
    } else {
      runNamed(`
        UPDATE feed_notification_rules
        SET enabled = @enabled,
            check_interval_minutes = @check_interval_minutes,
            next_check_at = @next_check_at,
            updated_at = datetime('now')
        WHERE id = @id
      `, {
        id: rule.id,
        enabled: data.enabled ? 1 : 0,
        check_interval_minutes: data.check_interval_minutes,
        next_check_at: nextCheckAt,
      })
      rule = getFeedNotificationRule(feedId, scopedUserId)!
    }

    const desired = new Set(data.channel_ids)
    const existingBindings = getDb().prepare(`
      SELECT channel_id
      FROM feed_notification_rule_channels
      WHERE rule_id = ?
    `).all(rule.id) as Array<{ channel_id: number }>
    const existingIds = new Set(existingBindings.map(row => row.channel_id))

    for (const channelId of existingIds) {
      if (!desired.has(channelId)) {
        getDb().prepare('DELETE FROM feed_notification_rule_channels WHERE rule_id = ? AND channel_id = ?').run(rule.id, channelId)
      }
    }

    const initialLastArticleId = latestFeedArticleId(feedId)
    for (const channelId of desired) {
      if (existingIds.has(channelId)) continue
      runNamed(`
        INSERT INTO feed_notification_rule_channels (
          rule_id, channel_id, last_notified_article_id, last_notified_at, last_error, updated_at
        )
        VALUES (@rule_id, @channel_id, @last_notified_article_id, NULL, NULL, datetime('now'))
      `, {
        rule_id: rule.id,
        channel_id: channelId,
        last_notified_article_id: initialLastArticleId,
      })
    }

    return getFeedNotificationRule(feedId, scopedUserId)!
  })()
}

export function deleteFeedNotificationRule(feedId: number, userId?: number | null): boolean {
  const scopedUserId = resolveUserId(userId)
  const scope = scopeWhere('user_id', scopedUserId)
  const result = getDb().prepare(`
    DELETE FROM feed_notification_rules
    WHERE feed_id = ?
      AND ${scope.clause}
  `).run(feedId, ...scope.params)
  return result.changes > 0
}

export function listDueNotificationRules(): DueNotificationRule[] {
  return getDb().prepare(`
    SELECT r.*, f.name AS feed_name
    FROM feed_notification_rules r
    JOIN feeds f ON f.id = r.feed_id
    WHERE r.enabled = 1
      AND f.disabled = 0
      AND r.next_check_at IS NOT NULL
      AND r.next_check_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    ORDER BY r.next_check_at ASC, r.id ASC
  `).all() as DueNotificationRule[]
}

export function listRuleBindings(ruleId: number): FeedNotificationBinding[] {
  return getDb().prepare(`
    SELECT *
    FROM feed_notification_rule_channels
    WHERE rule_id = ?
    ORDER BY channel_id ASC
  `).all(ruleId) as FeedNotificationBinding[]
}

export function getPendingNotificationArticles(
  feedId: number,
  lastNotifiedArticleId: number | null,
): { total: number; maxArticleId: number | null; articles: NotificationArticleRecord[] } {
  const params = lastNotifiedArticleId == null ? [feedId] : [feedId, lastNotifiedArticleId]
  const filter = lastNotifiedArticleId == null ? '' : 'AND id > ?'
  const totalRow = getDb().prepare(`
    SELECT COUNT(*) AS total, MAX(id) AS max_article_id
    FROM articles
    WHERE feed_id = ?
      AND purged_at IS NULL
      ${filter}
  `).get(...params) as { total: number; max_article_id: number | null }

  const articles = getDb().prepare(`
    SELECT id, title, url, published_at, fetched_at, notification_body_text, notification_media_json
    FROM articles
    WHERE feed_id = ?
      AND purged_at IS NULL
      ${filter}
    ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC
    LIMIT 5
  `).all(...params) as NotificationArticleRecord[]

  return {
    total: totalRow.total ?? 0,
    maxArticleId: totalRow.max_article_id ?? null,
    articles,
  }
}

export function markNotificationBindingDelivered(ruleId: number, channelId: number, articleId: number): void {
  getDb().prepare(`
    UPDATE feed_notification_rule_channels
    SET last_notified_article_id = ?,
        last_notified_at = datetime('now'),
        last_error = NULL,
        updated_at = datetime('now')
    WHERE rule_id = ? AND channel_id = ?
  `).run(articleId, ruleId, channelId)
}

export function markNotificationBindingError(ruleId: number, channelId: number, error: string): void {
  getDb().prepare(`
    UPDATE feed_notification_rule_channels
    SET last_error = ?,
        updated_at = datetime('now')
    WHERE rule_id = ? AND channel_id = ?
  `).run(error, ruleId, channelId)
}

export function markNotificationRuleChecked(ruleId: number, checkIntervalMinutes: number): void {
  getDb().prepare(`
    UPDATE feed_notification_rules
    SET last_checked_at = datetime('now'),
        next_check_at = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(nextCheckAtFromMinutes(checkIntervalMinutes), ruleId)
}
