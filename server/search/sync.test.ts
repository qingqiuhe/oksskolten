import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { getDb } from '../db/connection.js'

// Mock Meilisearch client
const {
  mockWaitTask,
  mockUpdateDocuments,
  mockAddDocuments,
  mockUpdateSettings,
  mockGetIndexes,
  mockCreateIndex,
  mockDeleteIndex,
  mockSwapIndexes,
  mockGetStats,
} = vi.hoisted(() => {
  const mockWaitTask = vi.fn().mockResolvedValue({})
  const taskResult = () => Object.assign(Promise.resolve({}), { waitTask: mockWaitTask })
  return {
    mockWaitTask,
    mockUpdateDocuments: vi.fn(() => taskResult()),
    mockAddDocuments: vi.fn(() => taskResult()),
    mockUpdateSettings: vi.fn(() => taskResult()),
    mockGetIndexes: vi.fn().mockResolvedValue({ results: [] }),
    mockCreateIndex: vi.fn(() => taskResult()),
    mockDeleteIndex: vi.fn(() => taskResult()),
    mockSwapIndexes: vi.fn(() => taskResult()),
    mockGetStats: vi.fn().mockResolvedValue({ numberOfDocuments: 0 }),
  }
})

vi.mock('./client.js', () => ({
  getSearchClient: () => ({
    getIndexes: mockGetIndexes,
    createIndex: mockCreateIndex,
    deleteIndex: mockDeleteIndex,
    swapIndexes: mockSwapIndexes,
    index: () => ({
      updateDocuments: mockUpdateDocuments,
      addDocuments: mockAddDocuments,
      updateSettings: mockUpdateSettings,
      getStats: mockGetStats,
    }),
  }),
  ARTICLES_INDEX: 'articles',
  ARTICLES_STAGING_INDEX: 'articles_staging',
}))

import {
  rebuildSearchIndex,
  syncAllScoredArticlesToSearch,
  syncArticleScoresToSearch,
  syncArticleScoreUpdatesToSearch,
  getSearchSyncMetrics,
  resetSearchSyncMetricsForTest,
  checkSearchIndexHealth,
  _setRebuilding,
} from './sync.js'

function seedFeed(): number {
  return getDb().prepare(
    "INSERT INTO feeds (name, url) VALUES ('Test', 'https://example.com/feed')"
  ).run().lastInsertRowid as number
}

function seedArticle(feedId: number, opts: { url: string; published_at?: string }): number {
  return getDb().prepare(
    'INSERT INTO articles (feed_id, title, url, published_at) VALUES (?, ?, ?, ?)'
  ).run(feedId, 'Test Article', opts.url, opts.published_at ?? new Date().toISOString()).lastInsertRowid as number
}

function mockArg<T>(calls: unknown[][], callIndex = 0, argIndex = 0): T {
  return calls[callIndex][argIndex] as T
}

describe('syncAllScoredArticlesToSearch', () => {
  beforeEach(() => {
    setupTestDb()
    resetSearchSyncMetricsForTest()
    mockUpdateDocuments.mockClear()
    mockAddDocuments.mockClear()
    mockUpdateSettings.mockClear()
    mockGetIndexes.mockClear()
    mockGetIndexes.mockResolvedValue({ results: [] })
    mockCreateIndex.mockClear()
    mockDeleteIndex.mockClear()
    mockSwapIndexes.mockClear()
    mockWaitTask.mockClear()
    _setRebuilding(false)
  })

  it('syncs articles with engagement to Meilisearch and returns count', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/1' })
    seedArticle(feedId, { url: 'https://example.com/2' })

    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 10.0 WHERE id = ?").run(id1)

    const synced = await syncAllScoredArticlesToSearch()

    expect(synced).toBe(1)
    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockArg<{ id: number; score: number }[]>(mockUpdateDocuments.mock.calls as unknown[][])
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(id1)
    expect(docs[0].score).toBeGreaterThan(0)
    expect(mockWaitTask).toHaveBeenCalledTimes(1)
  })

  it('returns 0 when no articles qualify', async () => {
    const feedId = seedFeed()
    seedArticle(feedId, { url: 'https://example.com/no-engagement' })

    const synced = await syncAllScoredArticlesToSearch()

    expect(synced).toBe(0)
    expect(mockUpdateDocuments).not.toHaveBeenCalled()
  })

  it('includes articles with score > 0 but no engagement flags', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/residual' })

    getDb().prepare('UPDATE articles SET score = 5.0 WHERE id = ?').run(id1)

    await syncAllScoredArticlesToSearch()

    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockArg<{ id: number; score: number }[]>(mockUpdateDocuments.mock.calls as unknown[][])
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(id1)
  })

  it('syncs multiple qualifying articles in one call', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/a' })
    const id2 = seedArticle(feedId, { url: 'https://example.com/b' })
    const id3 = seedArticle(feedId, { url: 'https://example.com/c' })

    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 10.0 WHERE id = ?").run(id1)
    getDb().prepare("UPDATE articles SET bookmarked_at = datetime('now'), score = 5.0 WHERE id = ?").run(id2)
    getDb().prepare("UPDATE articles SET read_at = datetime('now'), score = 2.0 WHERE id = ?").run(id3)

    await syncAllScoredArticlesToSearch()

    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockArg<{ id: number; score: number }[]>(mockUpdateDocuments.mock.calls as unknown[][])
    expect(docs).toHaveLength(3)
    const ids = docs.map(d => d.id).sort()
    expect(ids).toEqual([id1, id2, id3].sort())
  })

  it('returns 0 and skips sync when index rebuild is in progress', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/rebuilding' })
    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 10.0 WHERE id = ?").run(id1)

    _setRebuilding(true)

    const synced = await syncAllScoredArticlesToSearch()

    expect(synced).toBe(0)
    expect(mockUpdateDocuments).not.toHaveBeenCalled()
  })

  it('sends only id and score fields to Meilisearch', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/fields' })
    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 7.5 WHERE id = ?").run(id1)

    await syncAllScoredArticlesToSearch()

    const docs = mockArg<Record<string, unknown>[]>(mockUpdateDocuments.mock.calls as unknown[][])
    expect(Object.keys(docs[0]).sort()).toEqual(['id', 'score'])
  })

  it('streams qualifying score updates in batches', async () => {
    const feedId = seedFeed()
    for (let i = 0; i < 1001; i++) {
      const id = seedArticle(feedId, { url: `https://example.com/batch-score-${i}` })
      getDb().prepare('UPDATE articles SET score = 1.0 WHERE id = ?').run(id)
    }

    const synced = await syncAllScoredArticlesToSearch()

    expect(synced).toBe(1001)
    expect(mockUpdateDocuments).toHaveBeenCalledTimes(2)
    expect(mockArg<unknown[]>(mockUpdateDocuments.mock.calls as unknown[][], 0)).toHaveLength(1000)
    expect(mockArg<unknown[]>(mockUpdateDocuments.mock.calls as unknown[][], 1)).toHaveLength(1)
  })
})

describe('syncArticleScoresToSearch', () => {
  beforeEach(() => {
    setupTestDb()
    mockUpdateDocuments.mockClear()
    mockAddDocuments.mockClear()
    mockUpdateSettings.mockClear()
    mockGetIndexes.mockClear()
    mockGetIndexes.mockResolvedValue({ results: [] })
    mockCreateIndex.mockClear()
    mockDeleteIndex.mockClear()
    mockSwapIndexes.mockClear()
    mockWaitTask.mockClear()
    _setRebuilding(false)
  })

  it('syncs only the requested active article scores and deduplicates ids', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/dirty-1' })
    const id2 = seedArticle(feedId, { url: 'https://example.com/dirty-2' })
    const id3 = seedArticle(feedId, { url: 'https://example.com/not-dirty' })
    getDb().prepare('UPDATE articles SET score = 3.0 WHERE id = ?').run(id1)
    getDb().prepare('UPDATE articles SET score = 7.0 WHERE id = ?').run(id2)
    getDb().prepare('UPDATE articles SET score = 11.0 WHERE id = ?').run(id3)

    const synced = await syncArticleScoresToSearch([id2, id1, id2, 9999])

    expect(synced).toBe(2)
    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockArg<{ id: number; score: number }[]>(mockUpdateDocuments.mock.calls as unknown[][])
    expect(docs.map(doc => doc.id)).toEqual([id1, id2])
    expect(docs.map(doc => doc.score)).toEqual([3, 7])
  })

  it('streams requested score updates in batches', async () => {
    const feedId = seedFeed()
    const ids: number[] = []
    for (let i = 0; i < 1001; i++) {
      const id = seedArticle(feedId, { url: `https://example.com/dirty-batch-${i}` })
      ids.push(id)
      getDb().prepare('UPDATE articles SET score = 1.0 WHERE id = ?').run(id)
    }

    const synced = await syncArticleScoresToSearch(ids)

    expect(synced).toBe(1001)
    expect(mockUpdateDocuments).toHaveBeenCalledTimes(3)
    expect(mockArg<unknown[]>(mockUpdateDocuments.mock.calls as unknown[][], 0)).toHaveLength(500)
    expect(mockArg<unknown[]>(mockUpdateDocuments.mock.calls as unknown[][], 1)).toHaveLength(500)
    expect(mockArg<unknown[]>(mockUpdateDocuments.mock.calls as unknown[][], 2)).toHaveLength(1)
  })

  it('returns 0 and skips requested ids when index rebuild is in progress', async () => {
    const feedId = seedFeed()
    const id = seedArticle(feedId, { url: 'https://example.com/dirty-rebuilding' })
    getDb().prepare('UPDATE articles SET score = 9.0 WHERE id = ?').run(id)
    _setRebuilding(true)

    const synced = await syncArticleScoresToSearch([id])

    expect(synced).toBe(0)
    expect(mockUpdateDocuments).not.toHaveBeenCalled()
  })
})

describe('syncArticleScoreUpdatesToSearch', () => {
  beforeEach(() => {
    setupTestDb()
    mockUpdateDocuments.mockClear()
    mockAddDocuments.mockClear()
    mockUpdateSettings.mockClear()
    mockGetIndexes.mockClear()
    mockGetIndexes.mockResolvedValue({ results: [] })
    mockCreateIndex.mockClear()
    mockDeleteIndex.mockClear()
    mockSwapIndexes.mockClear()
    mockWaitTask.mockClear()
    _setRebuilding(false)
  })

  it('syncs precomputed scores without looking them up in SQLite', async () => {
    const synced = await syncArticleScoreUpdatesToSearch([
      { id: 2, score: 7 },
      { id: 1, score: 3 },
      { id: 2, score: 8 },
    ])

    expect(synced).toBe(2)
    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockArg<{ id: number; score: number }[]>(mockUpdateDocuments.mock.calls as unknown[][])
    expect(docs).toEqual([
      { id: 1, score: 3 },
      { id: 2, score: 8 },
    ])
  })

  it('streams precomputed score updates in Meilisearch batches', async () => {
    const updates = Array.from({ length: 1001 }, (_, index) => ({
      id: index + 1,
      score: index / 10,
    }))

    const synced = await syncArticleScoreUpdatesToSearch(updates)

    expect(synced).toBe(1001)
    expect(mockUpdateDocuments).toHaveBeenCalledTimes(2)
    expect(mockArg<unknown[]>(mockUpdateDocuments.mock.calls as unknown[][], 0)).toHaveLength(1000)
    expect(mockArg<unknown[]>(mockUpdateDocuments.mock.calls as unknown[][], 1)).toHaveLength(1)
  })

  it('returns 0 and skips precomputed updates when index rebuild is in progress', async () => {
    _setRebuilding(true)

    const synced = await syncArticleScoreUpdatesToSearch([{ id: 1, score: 9 }])

    expect(synced).toBe(0)
    expect(mockUpdateDocuments).not.toHaveBeenCalled()
  })
})

describe('rebuildSearchIndex', () => {
  beforeEach(() => {
    setupTestDb()
    mockUpdateDocuments.mockClear()
    mockAddDocuments.mockClear()
    mockUpdateSettings.mockClear()
    mockGetIndexes.mockClear()
    mockGetIndexes.mockResolvedValue({ results: [] })
    mockCreateIndex.mockClear()
    mockDeleteIndex.mockClear()
    mockSwapIndexes.mockClear()
    mockWaitTask.mockClear()
    _setRebuilding(false)
  })

  it('streams active articles into the staging index in batches', async () => {
    const feedId = seedFeed()
    for (let i = 0; i < 1001; i++) {
      seedArticle(feedId, { url: `https://example.com/rebuild-${i}` })
    }

    await rebuildSearchIndex()

    expect(mockAddDocuments).toHaveBeenCalledTimes(2)
    expect(mockArg<unknown[]>(mockAddDocuments.mock.calls as unknown[][], 0)).toHaveLength(1000)
    expect(mockArg<unknown[]>(mockAddDocuments.mock.calls as unknown[][], 1)).toHaveLength(1)
    const firstDoc = mockArg<Record<string, unknown>[]>(mockAddDocuments.mock.calls as unknown[][])[0]
    expect(typeof firstDoc.is_unread).toBe('boolean')
    expect(typeof firstDoc.is_liked).toBe('boolean')
    expect(typeof firstDoc.is_bookmarked).toBe('boolean')
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    expect(mockSwapIndexes).toHaveBeenCalledTimes(1)

    const metrics = getSearchSyncMetrics()
    expect(metrics.lastRebuildDurationMs).toBeGreaterThanOrEqual(0)
    expect(metrics.lastRebuildPeakRssMb).toBeGreaterThan(0)
    expect(metrics.lastRebuildAt).not.toBeNull()
  })
})

describe('checkSearchIndexHealth', () => {
  beforeEach(() => {
    setupTestDb()
    mockGetStats.mockClear()
  })

  it('returns healthy when document counts match closely', async () => {
    const feedId = seedFeed()
    seedArticle(feedId, { url: 'https://example.com/health-1' })
    mockGetStats.mockResolvedValue({ numberOfDocuments: 1 })

    const health = await checkSearchIndexHealth()
    expect(health.healthy).toBe(true)
    expect(health.dbCount).toBe(1)
    expect(health.searchCount).toBe(1)
  })

  it('detects significant desync between SQLite and Meilisearch', async () => {
    const feedId = seedFeed()
    for (let i = 0; i < 60; i++) {
      seedArticle(feedId, { url: `https://example.com/desync-${i}` })
    }
    mockGetStats.mockResolvedValue({ numberOfDocuments: 0 })

    const health = await checkSearchIndexHealth()
    expect(health.healthy).toBe(false)
    expect(health.reason).toContain('Document count mismatch')
  })

  it('returns unhealthy when Meilisearch stats call throws', async () => {
    mockGetStats.mockRejectedValue(new Error('Connection refused'))

    const health = await checkSearchIndexHealth()
    expect(health.healthy).toBe(false)
    expect(health.reason).toBe('Connection refused')
  })
})
