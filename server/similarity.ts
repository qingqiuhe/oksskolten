import { meiliSearch, buildMeiliFilter } from './search/client.js'
import { isSearchReady } from './search/sync.js'
import { getArticlesByIds, markArticleSeen } from './db.js'
import { insertSimilarity } from './db/similarities.js'
import { logger } from './logger.js'

const log = logger.child('similarity')

const SIMILARITY_THRESHOLD = 0.4
const TIME_WINDOW_DAYS = 3
const MAX_CANDIDATES = 10
const SIMILARITY_DETECTION_CONCURRENCY = 1
const SIMILARITY_BATCH_SIZE = 10

export interface SimilarityDetectionTask {
  articleId: number
  title: string
  feedId: number
  publishedAt: string | null
}

const pendingSimilarityTasks = new Map<number, SimilarityDetectionTask>()
const idleResolvers = new Set<() => void>()
let activeSimilarityTasks = 0

function maybeResolveIdle(): void {
  if (activeSimilarityTasks !== 0 || pendingSimilarityTasks.size !== 0) return
  for (const resolve of idleResolvers) resolve()
  idleResolvers.clear()
}

function takeNextTask(): SimilarityDetectionTask | undefined {
  const next = pendingSimilarityTasks.values().next()
  if (next.done) return undefined
  pendingSimilarityTasks.delete(next.value.articleId)
  return next.value
}

async function runLimited<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return
        await worker(items[index])
      }
    }),
  )
}

function pumpSimilarityQueue(): void {
  while (activeSimilarityTasks < SIMILARITY_DETECTION_CONCURRENCY) {
    const batch: SimilarityDetectionTask[] = []
    while (batch.length < SIMILARITY_BATCH_SIZE) {
      const task = takeNextTask()
      if (!task) break
      batch.push(task)
    }
    if (batch.length === 0) break

    activeSimilarityTasks += 1
    void detectAndStoreSimilarArticlesBatch(batch)
      .finally(() => {
        activeSimilarityTasks -= 1
        pumpSimilarityQueue()
        maybeResolveIdle()
      })
  }
  maybeResolveIdle()
}

export function enqueueSimilarityDetection(task: SimilarityDetectionTask): void {
  pendingSimilarityTasks.set(task.articleId, task)
  pumpSimilarityQueue()
}

export function enqueueSimilarityBatch(tasks: SimilarityDetectionTask[]): void {
  for (const task of tasks) {
    pendingSimilarityTasks.set(task.articleId, task)
  }
  pumpSimilarityQueue()
}

/** @internal Test-only helper to wait for queued similarity work. */
export function _awaitSimilarityQueueIdle(): Promise<void> {
  if (activeSimilarityTasks === 0 && pendingSimilarityTasks.size === 0) return Promise.resolve()
  return new Promise(resolve => idleResolvers.add(resolve))
}

/** @internal Test-only helper to clear pending similarity work. */
export function _resetSimilarityQueueForTests(): void {
  pendingSimilarityTasks.clear()
  activeSimilarityTasks = 0
  idleResolvers.clear()
}

/**
 * Compute bigram Dice coefficient between two strings.
 * Returns a value between 0 (no overlap) and 1 (identical bigrams).
 */
export function computeTitleSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim()

  const bigrams = (s: string): Set<string> => {
    const words = normalize(s).split(/\s+/)
    const set = new Set<string>()
    for (const w of words) {
      for (let i = 0; i < w.length - 1; i++) set.add(w.slice(i, i + 2))
    }
    return set
  }

  const setA = bigrams(a)
  const setB = bigrams(b)
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const bg of setA) if (setB.has(bg)) intersection++

  return (2 * intersection) / (setA.size + setB.size)
}

/**
 * Detect and store similar articles for a batch of articles.
 * Batches Meilisearch candidate queries and combines candidate lookups into a single SQLite query.
 */
export async function detectAndStoreSimilarArticlesBatch(tasks: SimilarityDetectionTask[]): Promise<void> {
  if (!isSearchReady() || tasks.length === 0) return

  try {
    const taskCandidates = new Map<number, number[]>()
    const allCandidateIdSet = new Set<number>()

    // Run Meilisearch queries with max 2 concurrent requests
    await runLimited(tasks, 2, async (task) => {
      try {
        const refDate = task.publishedAt ? new Date(task.publishedAt) : new Date()
        const since = new Date(refDate.getTime() - TIME_WINDOW_DAYS * 86_400_000).toISOString()
        const until = new Date(refDate.getTime() + TIME_WINDOW_DAYS * 86_400_000).toISOString()
        const filter = buildMeiliFilter({ since, until })

        const { hits } = await meiliSearch(task.title, {
          limit: MAX_CANDIDATES + 1,
          filter,
        })

        const candidateIds = hits
          .map((h) => h.id)
          .filter((id) => id !== task.articleId)

        taskCandidates.set(task.articleId, candidateIds)
        for (const id of candidateIds) {
          allCandidateIdSet.add(id)
        }
      } catch (err) {
        log.warn(`Similarity candidate search failed for article ${task.articleId}: ${err instanceof Error ? err.message : err}`)
      }
    })

    if (allCandidateIdSet.size === 0) return

    // Fetch all unique candidate articles in a single DB query
    const candidates = getArticlesByIds([...allCandidateIdSet])
    const candidateMap = new Map(candidates.map((c) => [c.id, c]))

    for (const task of tasks) {
      const candidateIds = taskCandidates.get(task.articleId) ?? []
      let markedSeen = false

      for (const candidateId of candidateIds) {
        const candidate = candidateMap.get(candidateId)
        if (!candidate) continue
        if (candidate.feed_id === task.feedId) continue

        const score = computeTitleSimilarity(task.title, candidate.title)
        if (score < SIMILARITY_THRESHOLD) continue

        insertSimilarity(task.articleId, candidate.id, score)

        if (!markedSeen && candidate.read_at) {
          markArticleSeen(task.articleId, true)
          markedSeen = true
          log.info(`Auto-marked article ${task.articleId} as seen (similar to read article ${candidate.id})`)
        }
      }
    }
  } catch (err) {
    log.warn(`Similarity batch detection failed: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Detect and store similar articles for a newly inserted article.
 * Runs asynchronously (fire-and-forget) after article insertion.
 */
export async function detectAndStoreSimilarArticles(
  articleId: number,
  title: string,
  feedId: number,
  publishedAt: string | null,
): Promise<void> {
  await detectAndStoreSimilarArticlesBatch([{ articleId, title, feedId, publishedAt }])
}
