import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, createUser, getDb, insertArticle, upsertInboxTopicCooldown } from '../db.js'

beforeEach(() => {
  setupTestDb()
})

function seedArticle(userId: number) {
  const feed = createFeed({ name: 'Cooldown Feed', url: `https://cooldown-${userId}.example.com` }, userId)
  return insertArticle({
    user_id: userId,
    feed_id: feed.id,
    title: 'Cooldown Article',
    url: `https://cooldown-${userId}.example.com/article`,
    published_at: '2026-06-10T00:00:00Z',
  })
}

describe('upsertInboxTopicCooldown', () => {
  it('uses returning for user-scoped cooldown upserts', () => {
    const user = createUser({
      email: 'cooldown@example.com',
      passwordHash: 'hash',
      role: 'member',
      status: 'active',
    })
    const articleId = seedArticle(user.id)
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const created = upsertInboxTopicCooldown(articleId, user.id)
    const updated = upsertInboxTopicCooldown(articleId, user.id, 30)

    expect(created.id).toBe(updated.id)
    expect(updated.user_id).toBe(user.id)
    expect(preparedSql.filter(sql => sql.includes('INSERT INTO inbox_topic_cooldowns') && sql.includes('RETURNING'))).toHaveLength(2)
    expect(preparedSql.some(sql => sql.includes('WHERE user_id = ? AND anchor_article_id = ?'))).toBe(false)
  })

  it('uses returning for anonymous cooldown inserts and updates', () => {
    const user = createUser({
      email: 'anonymous-cooldown@example.com',
      passwordHash: 'hash',
      role: 'member',
      status: 'active',
    })
    const articleId = seedArticle(user.id)
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const created = upsertInboxTopicCooldown(articleId, null)
    const updated = upsertInboxTopicCooldown(articleId, null, 30)

    expect(created.id).toBe(updated.id)
    expect(updated.user_id).toBeNull()
    expect(preparedSql.some(sql => sql.includes('INSERT INTO inbox_topic_cooldowns') && sql.includes('RETURNING'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('UPDATE inbox_topic_cooldowns') && sql.includes('RETURNING'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT id, user_id, anchor_article_id, created_at, expires_at') && sql.includes('WHERE id = ?'))).toBe(false)
  })
})
