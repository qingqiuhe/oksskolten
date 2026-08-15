import { getSearchClient, ARTICLES_INDEX, ARTICLES_STAGING_INDEX, type MeiliArticleDoc } from './client.js'
import { getDb } from '../db/connection.js'
import { SCORED_ARTICLES_WHERE } from '../db/articles.js'
import { logger } from '../logger.js'

const log = logger.child('search')

// --- Metrics ---

export interface SearchSyncMetrics {
  lastRebuildDurationMs: number | null
  lastRebuildPeakRssMb: number | null
  lastRebuildAt: string | null
  dirtyScoreSyncCount: number
  fullScoreSyncCount: number
  incrementalUpsertCount: number
  incrementalDeleteCount: number
}

const syncMetrics: SearchSyncMetrics = {
  lastRebuildDurationMs: null,
  lastRebuildPeakRssMb: null,
  lastRebuildAt: null,
  dirtyScoreSyncCount: 0,
  fullScoreSyncCount: 0,
  incrementalUpsertCount: 0,
  incrementalDeleteCount: 0,
}

export function getSearchSyncMetrics(): SearchSyncMetrics {
  return { ...syncMetrics }
}

export function resetSearchSyncMetricsForTest(): void {
  syncMetrics.lastRebuildDurationMs = null
  syncMetrics.lastRebuildPeakRssMb = null
  syncMetrics.lastRebuildAt = null
  syncMetrics.dirtyScoreSyncCount = 0
  syncMetrics.fullScoreSyncCount = 0
  syncMetrics.incrementalUpsertCount = 0
  syncMetrics.incrementalDeleteCount = 0
}

// --- State ---

let searchReady = false
let rebuilding = false

export function isSearchReady(): boolean {
  return searchReady
}

/** @internal Test-only helper to control rebuilding flag */
export function _setRebuilding(value: boolean): void {
  rebuilding = value
}

// --- Change log for rebuild consistency ---

type ChangeEntry =
  | { action: 'upsert'; id: number; doc: MeiliArticleDoc }
  | { action: 'delete'; id: number }

let changeLog: ChangeEntry[] | null = null

// --- Index settings ---

const INDEX_SETTINGS = {
  searchableAttributes: ['title', 'full_text', 'full_text_translated'],
  filterableAttributes: ['user_id', 'feed_id', 'category_id', 'lang', 'published_at', 'is_unread', 'is_liked', 'is_bookmarked'],
  sortableAttributes: ['published_at', 'score'],
  rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
}

// --- Rebuild ---

const BATCH_SIZE = 1000
const ID_LOOKUP_BATCH_SIZE = 500
const SEARCH_DOC_COLUMNS = `
  id, user_id, feed_id, category_id, title,
  COALESCE(full_text, '') AS full_text,
  COALESCE(full_text_translated, '') AS full_text_translated,
  lang,
  COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
  COALESCE(score, 0) AS score,
  (seen_at IS NULL) AS is_unread,
  (liked_at IS NOT NULL) AS is_liked,
  (bookmarked_at IS NOT NULL) AS is_bookmarked
`

function normalizeMeiliDoc(row: MeiliArticleDoc): MeiliArticleDoc {
  return {
    ...row,
    is_unread: Boolean(row.is_unread),
    is_liked: Boolean(row.is_liked),
    is_bookmarked: Boolean(row.is_bookmarked),
  }
}

export async function rebuildSearchIndex(): Promise<void> {
  if (rebuilding) {
    log.info('Rebuild already in progress, skipping')
    return
  }
  rebuilding = true
  changeLog = []

  try {
    const client = getSearchClient()
    const startedAt = Date.now()

    // Collect existing index UIDs to avoid 404 requests
    const { results: existingIndexes } = await client.getIndexes()
    const indexSet = new Set(existingIndexes.map((idx: { uid: string }) => idx.uid))

    // 1. Create or reset staging index
    if (indexSet.has(ARTICLES_STAGING_INDEX)) {
      await client.deleteIndex(ARTICLES_STAGING_INDEX).waitTask({ timeout: 60_000 })
    }
    await client.createIndex(ARTICLES_STAGING_INDEX, { primaryKey: 'id' }).waitTask({ timeout: 60_000 })

    // 2. Apply index settings to staging
    const stagingIndex = client.index(ARTICLES_STAGING_INDEX)
    await stagingIndex.updateSettings(INDEX_SETTINGS).waitTask({ timeout: 60_000 })

    // 3. Stream articles from SQLite in keyset batches and insert into staging
    let indexedCount = 0
    let lastId = 0
    while (true) {
      const rows = getDb().prepare(`
        SELECT ${SEARCH_DOC_COLUMNS}
        FROM active_articles
        WHERE id > ?
        ORDER BY id
        LIMIT ?
      `).all(lastId, BATCH_SIZE) as MeiliArticleDoc[]
      if (rows.length === 0) break
      lastId = rows[rows.length - 1].id
      const batch = rows.map(normalizeMeiliDoc)
      await stagingIndex.addDocuments(batch).waitTask({ timeout: 60_000 })
      indexedCount += batch.length
    }

    // 4. Promote staging to production
    if (indexSet.has(ARTICLES_INDEX)) {
      // Swap articles <-> articles_staging, then clean up old data
      await client.swapIndexes([
        { indexes: [ARTICLES_INDEX, ARTICLES_STAGING_INDEX] } as any,
      ]).waitTask({ timeout: 60_000 })
      await client.deleteIndex(ARTICLES_STAGING_INDEX).waitTask({ timeout: 60_000 })
    } else {
      // First run: no existing articles index — create empty one for swap
      await client.createIndex(ARTICLES_INDEX, { primaryKey: 'id' }).waitTask({ timeout: 60_000 })
      await client.swapIndexes([
        { indexes: [ARTICLES_INDEX, ARTICLES_STAGING_INDEX] } as any,
      ]).waitTask({ timeout: 60_000 })
      await client.deleteIndex(ARTICLES_STAGING_INDEX).waitTask({ timeout: 60_000 })
    }

    // 5. Replay change log
    if (changeLog && changeLog.length > 0) {
      const prodIndex = client.index(ARTICLES_INDEX)
      const upserts = changeLog.filter((e): e is Extract<ChangeEntry, { action: 'upsert' }> => e.action === 'upsert')
      const deletes = changeLog.filter((e): e is Extract<ChangeEntry, { action: 'delete' }> => e.action === 'delete')

      if (upserts.length > 0) {
        await prodIndex.addDocuments(upserts.map((e) => e.doc)).waitTask({ timeout: 60_000 })
      }
      for (const del of deletes) {
        await prodIndex.deleteDocument(del.id)
      }
    }

    searchReady = true
    const duration = Date.now() - startedAt
    const peakRss = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10
    syncMetrics.lastRebuildDurationMs = duration
    syncMetrics.lastRebuildPeakRssMb = peakRss
    syncMetrics.lastRebuildAt = new Date().toISOString()
    const elapsed = (duration / 1000).toFixed(1)
    log.info(`Index rebuild complete: ${indexedCount} articles in ${elapsed}s (peak RSS ${peakRss}MB)`)
  } catch (err) {
    // On failure: keep searchReady as-is (true if previously built, false if first time)
    log.error('Index rebuild failed:', err)
  } finally {
    changeLog = null
    rebuilding = false
  }
}

// --- Fire-and-forget sync helpers ---

export function syncArticleToSearch(doc: MeiliArticleDoc): void {
  try {
    syncMetrics.incrementalUpsertCount += 1
    const client = getSearchClient()
    const index = client.index(ARTICLES_INDEX)
    index.addDocuments([doc]).catch((err) => {
      log.error('Failed to sync article:', err)
    })

    if (changeLog) {
      changeLog.push({ action: 'upsert', id: doc.id, doc })
    }
  } catch (err) {
    log.error('Failed to sync article:', err)
  }
}

export function deleteArticleFromSearch(id: number): void {
  try {
    syncMetrics.incrementalDeleteCount += 1
    const client = getSearchClient()
    const index = client.index(ARTICLES_INDEX)
    index.deleteDocument(id).catch((err) => {
      log.error('Failed to delete article from index:', err)
    })

    if (changeLog) {
      changeLog.push({ action: 'delete', id })
    }
  } catch (err) {
    log.error('Failed to delete article from index:', err)
  }
}

export function syncArticleScoreToSearch(id: number, score: number): void {
  try {
    const client = getSearchClient()
    const index = client.index(ARTICLES_INDEX)
    index.updateDocuments([{ id, score }]).catch((err) => {
      log.error('Failed to sync score:', err)
    })
  } catch (err) {
    log.error('Failed to sync score:', err)
  }
}

export interface ArticleScoreUpdate {
  id: number
  score: number
}

function normalizeScoreUpdates(updates: ArticleScoreUpdate[]): ArticleScoreUpdate[] {
  const byId = new Map<number, number>()
  for (const update of updates) {
    byId.set(update.id, update.score)
  }
  return [...byId]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => left.id - right.id)
}

export async function syncArticleScoreUpdatesToSearch(updates: ArticleScoreUpdate[]): Promise<number> {
  if (rebuilding) {
    log.info('Index rebuild in progress, skipping score sync')
    return 0
  }
  if (updates.length === 0) return 0

  const docs = normalizeScoreUpdates(updates)
  const client = getSearchClient()
  const index = client.index(ARTICLES_INDEX)
  let synced = 0

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE)
    await index.updateDocuments(batch).waitTask({ timeout: 60_000 })
    synced += batch.length
  }

  syncMetrics.dirtyScoreSyncCount += synced
  return synced
}

export async function syncArticleScoresToSearch(articleIds: number[]): Promise<number> {
  if (rebuilding) {
    log.info('Index rebuild in progress, skipping score sync')
    return 0
  }
  if (articleIds.length === 0) return 0

  const ids = [...new Set(articleIds)]
  const client = getSearchClient()
  const index = client.index(ARTICLES_INDEX)
  let synced = 0

  for (let i = 0; i < ids.length; i += ID_LOOKUP_BATCH_SIZE) {
    const batchIds = ids.slice(i, i + ID_LOOKUP_BATCH_SIZE)
    const placeholders = batchIds.map(() => '?').join(', ')
    const rows = getDb().prepare(`
      SELECT id, score FROM active_articles
      WHERE id IN (${placeholders})
      ORDER BY id
    `).all(...batchIds) as { id: number; score: number }[]
    if (rows.length === 0) continue
    await index.updateDocuments(rows.map(({ id, score }) => ({ id, score }))).waitTask({ timeout: 60_000 })
    synced += rows.length
  }

  syncMetrics.dirtyScoreSyncCount += synced
  return synced
}

export function syncArticleFiltersToSearch(updates: { id: number; is_unread?: boolean; is_liked?: boolean; is_bookmarked?: boolean }[]): void {
  if (updates.length === 0) return
  try {
    const client = getSearchClient()
    const index = client.index(ARTICLES_INDEX)
    index.updateDocuments(updates).catch((err) => {
      log.error('Failed to sync article filters:', err)
    })
  } catch (err) {
    log.error('Failed to sync article filters:', err)
  }
}

export function deleteArticlesFromSearch(articleIds: number[]): void {
  if (articleIds.length === 0) return
  try {
    syncMetrics.incrementalDeleteCount += articleIds.length
    const client = getSearchClient()
    const index = client.index(ARTICLES_INDEX)
    index.deleteDocuments({ filter: `id IN [${articleIds.join(',')}]` }).catch((err) => {
      log.error('Failed to batch delete articles:', err)
    })

    if (changeLog) {
      for (const id of articleIds) {
        changeLog.push({ action: 'delete', id })
      }
    }
  } catch (err) {
    log.error('Failed to batch delete articles:', err)
  }
}

/**
 * Bulk-sync scores for all articles that have engagement or a non-zero score.
 * Uses the shared SCORED_ARTICLES_WHERE clause from server/db/articles.ts.
 * Kept as a manual/full fallback; scheduled recalculation syncs by recalculated ids.
 * Skips if an index rebuild is in progress (the rebuild will include fresh scores).
 */
export async function syncAllScoredArticlesToSearch(): Promise<number> {
  if (rebuilding) {
    log.info('Index rebuild in progress, skipping score sync')
    return 0
  }

  const client = getSearchClient()
  const index = client.index(ARTICLES_INDEX)
  let synced = 0
  let lastId = 0

  while (true) {
    const batch = getDb().prepare(`
      SELECT id, score FROM active_articles
      WHERE id > ? AND ${SCORED_ARTICLES_WHERE}
      ORDER BY id
      LIMIT ?
    `).all(lastId, BATCH_SIZE) as { id: number; score: number }[]
    if (batch.length === 0) break
    lastId = batch[batch.length - 1].id
    await index.updateDocuments(batch.map(({ id, score }) => ({ id, score }))).waitTask({ timeout: 60_000 })
    synced += batch.length
  }

  syncMetrics.fullScoreSyncCount += synced
  return synced
}

export function syncArticlesByFeedToSearch(docs: MeiliArticleDoc[]): void {
  if (docs.length === 0) return
  try {
    syncMetrics.incrementalUpsertCount += docs.length
    const client = getSearchClient()
    const index = client.index(ARTICLES_INDEX)
    index.addDocuments(docs).catch((err) => {
      log.error('Failed to batch sync articles:', err)
    })

    if (changeLog) {
      for (const doc of docs) {
        changeLog.push({ action: 'upsert', id: doc.id, doc })
      }
    }
  } catch (err) {
    log.error('Failed to batch sync articles:', err)
  }
}

/**
 * Health check for search index.
 * Verifies reachability and checks if document counts between SQLite and Meilisearch are consistent.
 */
export async function checkSearchIndexHealth(): Promise<{ healthy: boolean; reason?: string; dbCount?: number; searchCount?: number }> {
  try {
    const client = getSearchClient()
    const index = client.index(ARTICLES_INDEX)
    const stats = await index.getStats()
    const dbRow = getDb().prepare('SELECT COUNT(*) as count FROM active_articles').get() as { count: number } | undefined
    const dbCount = dbRow?.count ?? 0
    const searchCount = stats.numberOfDocuments
    // If count difference is larger than 50 and 5% of active articles, mark unhealthy
    const diff = Math.abs(dbCount - searchCount)
    if (diff > Math.max(50, dbCount * 0.05)) {
      return {
        healthy: false,
        reason: `Document count mismatch (DB: ${dbCount}, Search: ${searchCount})`,
        dbCount,
        searchCount,
      }
    }
    return { healthy: true, dbCount, searchCount }
  } catch (err) {
    return { healthy: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
