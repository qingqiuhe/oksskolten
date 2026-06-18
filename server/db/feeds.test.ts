import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'

const {
  mockAddDocuments,
  mockUpdateDocuments,
  mockDeleteDocument,
  mockDeleteDocuments,
} = vi.hoisted(() => ({
  mockAddDocuments: vi.fn(() => Promise.resolve({})),
  mockUpdateDocuments: vi.fn(() => Promise.resolve({})),
  mockDeleteDocument: vi.fn(() => Promise.resolve({})),
  mockDeleteDocuments: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../search/client.js', () => ({
  ARTICLES_INDEX: 'articles',
  getSearchClient: () => ({
    index: () => ({
      addDocuments: mockAddDocuments,
      updateDocuments: mockUpdateDocuments,
      deleteDocument: mockDeleteDocument,
      deleteDocuments: mockDeleteDocuments,
    }),
  }),
}))

import {
  createFeed,
  createUser,
  getDb,
  updateFeed,
  getFeedById,
  getFeeds,
  getEnabledFeeds,
  insertArticle,
  markArticleSeen,
  createCategory,
  bulkMoveFeedsToCategory,
  deleteFeed,
  updateFeedError,
  updateFeedRateLimit,
  updateFeedSchedule,
  markFeedFetchSuccess,
} from '../db.js'

beforeEach(() => {
  setupTestDb()
  mockAddDocuments.mockClear()
  mockUpdateDocuments.mockClear()
  mockDeleteDocument.mockClear()
  mockDeleteDocuments.mockClear()
})

function seedFeed(overrides: Partial<Parameters<typeof createFeed>[0]> = {}) {
  return createFeed({ name: 'Test Feed', url: 'https://example.com', ...overrides })
}

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({
    feed_id: feedId,
    title: 'Test Article',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2025-01-01T00:00:00Z',
    ...overrides,
  })
}

function seedUser(email: string) {
  return createUser({
    email,
    passwordHash: 'hash',
    role: 'member',
    status: 'active',
  }).id
}

describe('updateFeed category_id', () => {
  it('changes feed category and updates articles category_id', () => {
    const cat = createCategory('Tech')
    const feed = seedFeed()
    seedArticle(feed.id)

    updateFeed(feed.id, { category_id: cat.id })

    const updated = getFeedById(feed.id)!
    expect(updated.category_id).toBe(cat.id)

    // Articles should also have category_id updated
    // getArticleById doesn't expose category_id directly, but getFeeds shows category_name
    const feeds = getFeeds()
    expect(feeds[0].category_name).toBe('Tech')
  })

  it('sets category_id to null (uncategorize)', () => {
    const cat = createCategory('Tech')
    const feed = seedFeed({ category_id: cat.id })

    updateFeed(feed.id, { category_id: null })

    const updated = getFeedById(feed.id)!
    expect(updated.category_id).toBeNull()
  })

  it('does not sync articles when category_id is unchanged', () => {
    const cat = createCategory('Tech')
    const feed = seedFeed({ category_id: cat.id })
    const articleId = seedArticle(feed.id)
    mockAddDocuments.mockClear()

    updateFeed(feed.id, { category_id: cat.id })

    expect(getFeedById(feed.id)?.category_id).toBe(cat.id)
    expect(getDb().prepare('SELECT category_id FROM articles WHERE id = ?').get(articleId)).toMatchObject({ category_id: cat.id })
    expect(mockAddDocuments).not.toHaveBeenCalled()
  })

  it('syncs only active articles whose category changed', () => {
    const sourceCat = createCategory('Source')
    const targetCat = createCategory('Target')
    const feed = seedFeed({ category_id: sourceCat.id })
    const changedId = seedArticle(feed.id, { url: 'https://single-feed-change.example.com/active' })
    const purgedChangedId = seedArticle(feed.id, { url: 'https://single-feed-change.example.com/purged' })
    getDb().prepare('UPDATE articles SET purged_at = datetime(\'now\') WHERE id = ?').run(purgedChangedId)
    mockAddDocuments.mockClear()

    updateFeed(feed.id, { category_id: targetCat.id })

    expect(getFeedById(feed.id)?.category_id).toBe(targetCat.id)
    expect(mockAddDocuments).toHaveBeenCalledTimes(1)
    const calls = mockAddDocuments.mock.calls as unknown[][]
    const docs = calls[0][0] as { id: number; category_id: number | null }[]
    expect(docs).toEqual([expect.objectContaining({ id: changedId, category_id: targetCat.id })])
    const rows = getDb().prepare('SELECT id, category_id FROM articles WHERE id IN (?, ?) ORDER BY id').all(changedId, purgedChangedId)
    expect(rows).toEqual([
      { id: changedId, category_id: targetCat.id },
      { id: purgedChangedId, category_id: targetCat.id },
    ])
  })

  it('does not update article categories when feed update misses', () => {
    const sourceCat = createCategory('Source')
    const targetCat = createCategory('Target')
    const feed = seedFeed({ category_id: sourceCat.id })
    const articleId = seedArticle(feed.id)
    mockAddDocuments.mockClear()

    const result = updateFeed(999_999, { category_id: targetCat.id })

    expect(result).toBeUndefined()
    expect(getDb().prepare('SELECT category_id FROM articles WHERE id = ?').get(articleId)).toMatchObject({ category_id: sourceCat.id })
    expect(mockAddDocuments).not.toHaveBeenCalled()
  })
})

describe('updateFeed rss_url', () => {
  it('updates rss_url field', () => {
    const feed = seedFeed()

    updateFeed(feed.id, { rss_url: 'https://example.com/feed.xml' })

    const updated = getFeedById(feed.id)!
    expect(updated.rss_url).toBe('https://example.com/feed.xml')
  })

  it('sets rss_url to null', () => {
    const feed = seedFeed({ rss_url: 'https://example.com/feed.xml' })

    updateFeed(feed.id, { rss_url: null })

    const updated = getFeedById(feed.id)!
    expect(updated.rss_url).toBeNull()
  })

  it('returns updated feed without a follow-up row query', () => {
    const feed = seedFeed()
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const updated = updateFeed(feed.id, { rss_url: 'https://example.com/returning.xml' })

    expect(updated?.rss_url).toBe('https://example.com/returning.xml')
    expect(preparedSql.some(sql => sql.includes('UPDATE feeds SET') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM feeds WHERE id = ?'))).toBe(false)
  })
})

describe('updateFeed view_type', () => {
  it('updates view_type field', () => {
    const feed = seedFeed()

    updateFeed(feed.id, { view_type: 'social' })

    const updated = getFeedById(feed.id)!
    expect(updated.view_type).toBe('social')
  })

  it('clears view_type back to auto', () => {
    const feed = seedFeed({ view_type: 'article' })

    updateFeed(feed.id, { view_type: null })

    const updated = getFeedById(feed.id)!
    expect(updated.view_type).toBeNull()
  })
})

describe('feed icon_url', () => {
  it('persists icon_url on create', () => {
    const feed = seedFeed({ icon_url: 'https://example.com/icon.png' })

    expect(feed.icon_url).toBe('https://example.com/icon.png')
  })

  it('updates icon_url field', () => {
    const feed = seedFeed()

    updateFeed(feed.id, { icon_url: 'https://example.com/new-icon.png' })

    const updated = getFeedById(feed.id)!
    expect(updated.icon_url).toBe('https://example.com/new-icon.png')
  })

  it('clears icon_url field', () => {
    const feed = seedFeed({ icon_url: 'https://example.com/icon.png' })

    updateFeed(feed.id, { icon_url: null })

    const updated = getFeedById(feed.id)!
    expect(updated.icon_url).toBeNull()
  })
})

describe('updateFeed requires_js_challenge', () => {
  it('sets requires_js_challenge flag', () => {
    const feed = seedFeed()

    updateFeed(feed.id, { requires_js_challenge: 1 })

    const updated = getFeedById(feed.id)!
    expect(updated.requires_js_challenge).toBe(1)
  })

  it('clears requires_js_challenge flag', () => {
    const feed = seedFeed({ requires_js_challenge: 1 })

    updateFeed(feed.id, { requires_js_challenge: 0 })

    const updated = getFeedById(feed.id)!
    expect(updated.requires_js_challenge).toBe(0)
  })
})

describe('updateFeed no-op', () => {
  it('returns existing feed when no fields provided', () => {
    const feed = seedFeed({ name: 'Original' })

    const result = updateFeed(feed.id, {})

    expect(result).toBeDefined()
    expect(result!.name).toBe('Original')
  })
})

describe('bulkMoveFeedsToCategory', () => {
  it('syncs only active articles whose category changed', () => {
    const sourceCat = createCategory('Source')
    const targetCat = createCategory('Target')
    const moveFeed = seedFeed({ url: 'https://bulk-move.example.com/a', category_id: sourceCat.id })
    const alreadyTargetFeed = seedFeed({ url: 'https://bulk-move.example.com/b', category_id: targetCat.id })
    const changedId = seedArticle(moveFeed.id, { url: 'https://bulk-move.example.com/a/1' })
    const purgedChangedId = seedArticle(moveFeed.id, { url: 'https://bulk-move.example.com/a/purged' })
    const unchangedId = seedArticle(alreadyTargetFeed.id, { url: 'https://bulk-move.example.com/b/1' })
    getDb().prepare('UPDATE articles SET purged_at = datetime(\'now\') WHERE id = ?').run(purgedChangedId)
    mockAddDocuments.mockClear()

    bulkMoveFeedsToCategory([moveFeed.id, alreadyTargetFeed.id], targetCat.id)

    expect(getFeedById(moveFeed.id)?.category_id).toBe(targetCat.id)
    expect(getFeedById(alreadyTargetFeed.id)?.category_id).toBe(targetCat.id)
    expect(mockAddDocuments).toHaveBeenCalledTimes(1)
    const calls = mockAddDocuments.mock.calls as unknown[][]
    const docs = calls[0][0] as { id: number; category_id: number | null }[]
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ id: changedId, category_id: targetCat.id })
    const rows = getDb().prepare('SELECT id, category_id FROM articles WHERE id IN (?, ?, ?) ORDER BY id').all(changedId, purgedChangedId, unchangedId) as { id: number; category_id: number | null }[]
    expect(rows).toEqual([
      { id: changedId, category_id: targetCat.id },
      { id: purgedChangedId, category_id: targetCat.id },
      { id: unchangedId, category_id: targetCat.id },
    ])
  })
})

describe('deleteFeed', () => {
  it('deletes articles and removes only those ids from search', () => {
    const feed = seedFeed({ url: 'https://delete-feed.example.com/feed' })
    const otherFeed = seedFeed({ url: 'https://delete-feed.example.com/other' })
    const deletedIdA = seedArticle(feed.id, { url: 'https://delete-feed.example.com/a' })
    const deletedIdB = seedArticle(feed.id, { url: 'https://delete-feed.example.com/b' })
    const keptId = seedArticle(otherFeed.id, { url: 'https://delete-feed.example.com/kept' })
    mockDeleteDocuments.mockClear()

    expect(deleteFeed(feed.id)).toBe(true)

    expect(getFeedById(feed.id)).toBeUndefined()
    expect(getDb().prepare('SELECT id FROM articles WHERE id = ?').get(deletedIdA)).toBeUndefined()
    expect(getDb().prepare('SELECT id FROM articles WHERE id = ?').get(deletedIdB)).toBeUndefined()
    expect(getDb().prepare('SELECT id FROM articles WHERE id = ?').get(keptId)).toBeDefined()
    expect(mockDeleteDocuments).toHaveBeenCalledTimes(1)
    const calls = mockDeleteDocuments.mock.calls as unknown[][]
    expect(calls[0][0]).toEqual({ filter: `id IN [${deletedIdA},${deletedIdB}]` })
  })
})

describe('createFeed with all options', () => {
  it('creates feed with rss_url and category', () => {
    const cat = createCategory('Tech')
    const feed = createFeed({
      name: 'Full Feed',
      url: 'https://full.example.com',
      icon_url: 'https://full.example.com/icon.png',
      rss_url: 'https://full.example.com/rss',
      rss_bridge_url: 'https://bridge.example.com/rss',
      category_id: cat.id,
      requires_js_challenge: 1,
    })

    expect(feed.name).toBe('Full Feed')
    expect(feed.icon_url).toBe('https://full.example.com/icon.png')
    expect(feed.rss_url).toBe('https://full.example.com/rss')
    expect(feed.rss_bridge_url).toBe('https://bridge.example.com/rss')
    expect(feed.category_id).toBe(cat.id)
    expect(feed.requires_js_challenge).toBe(1)
    expect(feed.type).toBe('rss')
  })

  it('returns the inserted feed without a follow-up row query', () => {
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const feed = createFeed({
      name: 'Returning Feed',
      url: 'https://returning-feed.example.com',
    })

    expect(feed.name).toBe('Returning Feed')
    expect(preparedSql.some(sql => sql.includes('INSERT INTO feeds') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM feeds WHERE id = ?'))).toBe(false)
  })
})

describe('getFeeds articles_per_week', () => {
  it('derives articles_per_week from active articles instead of a stored feed column', () => {
    const feed = seedFeed()
    const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()

    for (let i = 0; i < 8; i++) {
      seedArticle(feed.id, { published_at: recent(i + 1) })
    }
    seedArticle(feed.id, { published_at: recent(40) })

    const feeds = getFeeds()
    expect(feeds[0].articles_per_week).toBe(2)
  })
})

describe('getFeeds user-scoped aggregation', () => {
  it('keeps feed counts scoped to the requested user', () => {
    const userA = seedUser('a@example.com')
    const userB = seedUser('b@example.com')
    const feedA = createFeed({ name: 'A Feed', url: 'https://a.example.com/feed' }, userA)
    const feedB = createFeed({ name: 'B Feed', url: 'https://b.example.com/feed' }, userB)

    seedArticle(feedA.id, { url: 'https://a.example.com/1' })
    seedArticle(feedA.id, { url: 'https://a.example.com/2' })
    for (let i = 0; i < 5; i++) {
      seedArticle(feedB.id, { url: `https://b.example.com/${i}` })
    }

    const feeds = getFeeds(userA)

    expect(feeds).toHaveLength(1)
    expect(feeds[0].id).toBe(feedA.id)
    expect(feeds[0].article_count).toBe(2)
    expect(feeds[0].unread_count).toBe(2)
  })

  it('can use the active feed counts covering index for scoped article aggregation', () => {
    const userA = seedUser('plan-a@example.com')
    const feedA = createFeed({ name: 'Plan A Feed', url: 'https://plan-a.example.com/feed' }, userA)
    seedArticle(feedA.id, { url: 'https://plan-a.example.com/1' })

    const plan = getDb().prepare(`
      EXPLAIN QUERY PLAN
      SELECT feed_id,
        COUNT(*) AS article_count,
        SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END) AS unread_count,
        COUNT(CASE WHEN COALESCE(published_at, fetched_at) >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-28 days') THEN 1 END) / 4.0 AS articles_per_week,
        MAX(COALESCE(published_at, fetched_at)) AS latest_published_at
      FROM active_articles
      WHERE user_id = ?
      GROUP BY feed_id
    `).all(userA) as { detail: string }[]

    expect(plan.some(row => row.detail.includes('idx_articles_user_active_feed_counts'))).toBe(true)
  })
})

describe('updateFeedError exponential backoff', () => {
  it('records error and increments error_count', () => {
    const feed = seedFeed()

    updateFeedError(feed.id, 'Connection timeout')

    const updated = getFeedById(feed.id)!
    expect(updated.last_error).toBe('Connection timeout')
    expect(updated.error_count).toBe(1)
  })

  it('does not set next_check_at for errorCount < 3', () => {
    const feed = seedFeed()

    updateFeedError(feed.id, 'Error 1')
    updateFeedError(feed.id, 'Error 2')

    const updated = getFeedById(feed.id)!
    expect(updated.error_count).toBe(2)
    expect(updated.next_check_at).toBeNull()
  })

  it('increments error_count without a follow-up count query', () => {
    const feed = seedFeed()
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    updateFeedError(feed.id, 'Error 1')

    expect(getFeedById(feed.id)?.error_count).toBe(1)
    expect(preparedSql.some(sql => sql.includes('RETURNING error_count'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT error_count FROM feeds'))).toBe(false)
  })

  it('sets next_check_at with backoff for errorCount >= 3', () => {
    const feed = seedFeed()

    updateFeedError(feed.id, 'Error 1')
    updateFeedError(feed.id, 'Error 2')
    updateFeedError(feed.id, 'Error 3')

    const updated = getFeedById(feed.id)!
    expect(updated.error_count).toBe(3)
    expect(updated.next_check_at).not.toBeNull()
    // errorCount=3 → backoff = 3600 * (3-2) = 3600s = 1h
    const nextCheck = new Date(updated.next_check_at!).getTime()
    const now = Date.now()
    // Should be roughly 1 hour from now (allow 30s tolerance)
    expect(nextCheck - now).toBeGreaterThan(3600 * 1000 - 30000)
    expect(nextCheck - now).toBeLessThan(3600 * 1000 + 30000)
  })

  it('caps backoff at 4 hours', () => {
    const feed = seedFeed()

    // Simulate 10 consecutive errors
    for (let i = 0; i < 10; i++) {
      updateFeedError(feed.id, `Error ${i + 1}`)
    }

    const updated = getFeedById(feed.id)!
    expect(updated.error_count).toBe(10)
    const nextCheck = new Date(updated.next_check_at!).getTime()
    const now = Date.now()
    // Max backoff = 4h = 14400s
    expect(nextCheck - now).toBeLessThan(14400 * 1000 + 30000)
  })

  it('clears error on success (null error)', () => {
    const feed = seedFeed()
    updateFeedError(feed.id, 'Error 1')
    updateFeedError(feed.id, 'Error 2')
    updateFeedError(feed.id, 'Error 3')

    // Clear error
    updateFeedError(feed.id, null)

    const updated = getFeedById(feed.id)!
    expect(updated.last_error).toBeNull()
    expect(updated.error_count).toBe(0)
  })

  it('records successful fetch metadata in one update', () => {
    const feed = seedFeed()
    updateFeedError(feed.id, 'Error 1')
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    markFeedFetchSuccess(feed.id, {
      nextCheckAt: '2026-06-10T01:00:00Z',
      checkInterval: 1800,
      etag: 'etag-1',
      lastModified: 'Wed, 10 Jun 2026 00:00:00 GMT',
      contentHash: 'hash-1',
    })

    const updated = getFeedById(feed.id)!
    expect(updated.last_error).toBeNull()
    expect(updated.error_count).toBe(0)
    expect(updated.etag).toBe('etag-1')
    expect(updated.last_modified).toBe('Wed, 10 Jun 2026 00:00:00 GMT')
    expect(updated.last_content_hash).toBe('hash-1')
    expect(updated.next_check_at).toBe('2026-06-10T01:00:00Z')
    expect(updated.check_interval).toBe(1800)
    const successUpdates = preparedSql.filter(sql => sql.includes('UPDATE feeds') && sql.includes('last_error = NULL'))
    expect(successUpdates).toHaveLength(1)
  })

  it('never disables feeds', () => {
    const feed = seedFeed()

    // Simulate many consecutive errors
    for (let i = 0; i < 20; i++) {
      updateFeedError(feed.id, `Error ${i + 1}`)
    }

    const updated = getFeedById(feed.id)!
    expect(updated.disabled).toBe(0)
    expect(updated.error_count).toBe(20)
  })
})

describe('updateFeedRateLimit', () => {
  it('sets next_check_at without incrementing error_count', () => {
    const feed = seedFeed()

    updateFeedRateLimit(feed.id, 1800) // 30 minutes

    const updated = getFeedById(feed.id)!
    expect(updated.error_count).toBe(0)
    expect(updated.next_check_at).not.toBeNull()
    expect(updated.last_error).toContain('Rate limited')
    const nextCheck = new Date(updated.next_check_at!).getTime()
    const now = Date.now()
    expect(nextCheck - now).toBeGreaterThan(1800 * 1000 - 30000)
    expect(nextCheck - now).toBeLessThan(1800 * 1000 + 30000)
  })

  it('defaults to 1 hour when retryAfterSeconds is null', () => {
    const feed = seedFeed()

    updateFeedRateLimit(feed.id, null)

    const updated = getFeedById(feed.id)!
    expect(updated.error_count).toBe(0)
    const nextCheck = new Date(updated.next_check_at!).getTime()
    const now = Date.now()
    expect(nextCheck - now).toBeGreaterThan(3600 * 1000 - 30000)
  })

  it('does not affect existing error_count', () => {
    const feed = seedFeed()
    // Simulate 2 prior errors
    updateFeedError(feed.id, 'Error 1')
    updateFeedError(feed.id, 'Error 2')

    // Rate limit should not touch error_count
    updateFeedRateLimit(feed.id, 600)

    const updated = getFeedById(feed.id)!
    expect(updated.error_count).toBe(2)
  })
})

describe('getEnabledFeeds scheduling', () => {
  it('returns feeds with next_check_at in the past', () => {
    const feed = seedFeed()
    const pastTime = new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    updateFeedSchedule(feed.id, pastTime, 3600)

    const enabled = getEnabledFeeds()
    expect(enabled.some(f => f.id === feed.id)).toBe(true)
  })

  it('returns feeds with null next_check_at', () => {
    const feed = seedFeed()

    const enabled = getEnabledFeeds()
    expect(enabled.some(f => f.id === feed.id)).toBe(true)
  })

  it('excludes feeds with next_check_at in the future', () => {
    const feed = seedFeed()
    const futureTime = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    updateFeedSchedule(feed.id, futureTime, 3600)

    const enabled = getEnabledFeeds()
    expect(enabled.some(f => f.id === feed.id)).toBe(false)
  })
})

describe('getFeeds unread count with seen articles', () => {
  it('decrements unread_count after marking articles seen', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })

    let feeds = getFeeds()
    expect(feeds[0].unread_count).toBe(2)

    markArticleSeen(id1, true)

    feeds = getFeeds()
    expect(feeds[0].unread_count).toBe(1)
  })
})
