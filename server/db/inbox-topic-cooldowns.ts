import { getDb, runNamed } from './connection.js'
import { getCurrentUserId } from '../identity.js'

export interface InboxTopicCooldown {
  id: number
  user_id: number | null
  anchor_article_id: number
  created_at: string
  expires_at: string
}

function resolveUserId(userId?: number | null): number | null {
  return userId ?? getCurrentUserId()
}

function toSqliteTimestamp(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function listActiveInboxTopicCooldowns(userId?: number | null): InboxTopicCooldown[] {
  const scopedUserId = resolveUserId(userId)
  if (scopedUserId == null) {
    return getDb().prepare(`
      SELECT id, user_id, anchor_article_id, created_at, expires_at
      FROM inbox_topic_cooldowns
      WHERE user_id IS NULL
        AND expires_at > datetime('now')
      ORDER BY expires_at DESC, id DESC
    `).all() as InboxTopicCooldown[]
  }

  return getDb().prepare(`
    SELECT id, user_id, anchor_article_id, created_at, expires_at
    FROM inbox_topic_cooldowns
    WHERE user_id = ?
      AND expires_at > datetime('now')
    ORDER BY expires_at DESC, id DESC
  `).all(scopedUserId) as InboxTopicCooldown[]
}

export function getActiveInboxTopicCooldownAnchorIds(userId?: number | null): number[] {
  return listActiveInboxTopicCooldowns(userId).map((row) => row.anchor_article_id)
}

export function upsertInboxTopicCooldown(anchorArticleId: number, userId?: number | null, durationDays = 14): InboxTopicCooldown {
  const scopedUserId = resolveUserId(userId)
  const expiresAt = toSqliteTimestamp(new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000))

  if (scopedUserId == null) {
    return getDb().transaction(() => {
      const existing = getDb().prepare(`
        SELECT id, user_id, anchor_article_id, created_at, expires_at
        FROM inbox_topic_cooldowns
        WHERE user_id IS NULL AND anchor_article_id = ?
      `).get(anchorArticleId) as InboxTopicCooldown | undefined

      if (existing) {
        getDb().prepare('UPDATE inbox_topic_cooldowns SET expires_at = ? WHERE id = ?').run(expiresAt, existing.id)
        return getDb().prepare(`
          SELECT id, user_id, anchor_article_id, created_at, expires_at
          FROM inbox_topic_cooldowns
          WHERE id = ?
        `).get(existing.id) as InboxTopicCooldown
      }

      const info = runNamed(`
        INSERT INTO inbox_topic_cooldowns (user_id, anchor_article_id, expires_at)
        VALUES (@user_id, @anchor_article_id, @expires_at)
      `, {
        user_id: null,
        anchor_article_id: anchorArticleId,
        expires_at: expiresAt,
      })

      return getDb().prepare(`
        SELECT id, user_id, anchor_article_id, created_at, expires_at
        FROM inbox_topic_cooldowns
        WHERE id = ?
      `).get(info.lastInsertRowid) as InboxTopicCooldown
    })()
  }

  runNamed(`
    INSERT INTO inbox_topic_cooldowns (user_id, anchor_article_id, expires_at)
    VALUES (@user_id, @anchor_article_id, @expires_at)
    ON CONFLICT(user_id, anchor_article_id)
    DO UPDATE SET expires_at = excluded.expires_at
  `, {
    user_id: scopedUserId,
    anchor_article_id: anchorArticleId,
    expires_at: expiresAt,
  })

  return getDb().prepare(`
    SELECT id, user_id, anchor_article_id, created_at, expires_at
    FROM inbox_topic_cooldowns
    WHERE user_id = ? AND anchor_article_id = ?
  `).get(scopedUserId, anchorArticleId) as InboxTopicCooldown
}
