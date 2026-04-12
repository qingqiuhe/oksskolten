import { getDb, runNamed, getNamed, allNamed } from './connection.js'
import type { Article, ArticleListItem, ArticleDetail, InboxSummary, HighValueArticle, HighValueResponse, InboxReasonCode } from './types.js'
import type { MeiliArticleDoc } from '../search/client.js'
import { syncArticleToSearch, deleteArticleFromSearch, deleteArticlesFromSearch, syncArticleScoreToSearch, syncArticleFiltersToSearch } from '../search/sync.js'
import { RETRY_MAX_ATTEMPTS, RETRY_BATCH_LIMIT } from '../fetcher/util.js'
import { deleteArticleImages } from '../fetcher/article-images.js'
import { logger } from '../logger.js'
import { detectArticleKindForFeed, isArticleKind, resolveFeedViewType, type ArticleKind, type FeedViewType } from '../../shared/article-kind.js'
import { getCurrentUserId } from '../identity.js'
import { listActiveInboxTopicCooldowns } from './inbox-topic-cooldowns.js'

const log = logger.child('retention')

/** Normalize a URL so that raw-Unicode and percent-encoded forms compare equal. */
function normalizeUrl(raw: string): string {
  try { return new URL(raw).href } catch { return raw }
}

function resolveUserId(userId?: number | null): number | null {
  return userId ?? getCurrentUserId()
}

function buildMeiliDoc(id: number): MeiliArticleDoc | null {
  const row = getDb().prepare(`
    SELECT id, user_id, feed_id, category_id, title,
           COALESCE(full_text, '') AS full_text,
           COALESCE(full_text_translated, '') AS full_text_translated,
           lang,
           COALESCE(CAST(strftime('%s', published_at) AS INTEGER), 0) AS published_at,
           COALESCE(score, 0) AS score,
           (seen_at IS NULL) AS is_unread,
           (liked_at IS NOT NULL) AS is_liked,
           (bookmarked_at IS NOT NULL) AS is_bookmarked
    FROM articles WHERE id = ?
  `).get(id) as MeiliArticleDoc | undefined
  return row ?? null
}

function hasVideoExpr(prefix: string): string {
  return `CASE WHEN COALESCE(${prefix}full_text, '') LIKE '%<video%' THEN 1 ELSE 0 END`
}

function isResolvedSocialFeedExpr(alias: string): string {
  return `(
    LOWER(COALESCE(${alias}.url, '')) LIKE '%://x.com/%'
    OR LOWER(COALESCE(${alias}.url, '')) LIKE '%://twitter.com/%'
    OR LOWER(COALESCE(${alias}.url, '')) LIKE '%://%.x.com/%'
    OR LOWER(COALESCE(${alias}.url, '')) LIKE '%://%.twitter.com/%'
    OR LOWER(COALESCE(${alias}.rss_url, '')) LIKE '%://x.com/%'
    OR LOWER(COALESCE(${alias}.rss_url, '')) LIKE '%://twitter.com/%'
    OR LOWER(COALESCE(${alias}.rss_url, '')) LIKE '%://%.x.com/%'
    OR LOWER(COALESCE(${alias}.rss_url, '')) LIKE '%://%.twitter.com/%'
    OR LOWER(COALESCE(${alias}.rss_bridge_url, '')) LIKE '%://x.com/%'
    OR LOWER(COALESCE(${alias}.rss_bridge_url, '')) LIKE '%://twitter.com/%'
    OR LOWER(COALESCE(${alias}.rss_bridge_url, '')) LIKE '%://%.x.com/%'
    OR LOWER(COALESCE(${alias}.rss_bridge_url, '')) LIKE '%://%.twitter.com/%'
    OR LOWER(COALESCE(${alias}.rss_url, '')) LIKE '%/twitter/%'
    OR LOWER(COALESCE(${alias}.rss_url, '')) LIKE '%/x/%'
    OR LOWER(COALESCE(${alias}.rss_bridge_url, '')) LIKE '%/twitter/%'
    OR LOWER(COALESCE(${alias}.rss_bridge_url, '')) LIKE '%/x/%'
  )`
}

function resolvedFeedViewTypeExpr(alias: string): string {
  return `CASE
    WHEN ${alias}.view_type IN ('article', 'social') THEN ${alias}.view_type
    WHEN ${isResolvedSocialFeedExpr(alias)} THEN 'social'
    ELSE 'article'
  END`
}

type ArticleListItemRow = ArticleListItem & {
  _feed_view_type_raw?: string | null
  _feed_url?: string | null
  _feed_rss_url?: string | null
  _feed_rss_bridge_url?: string | null
}

type HighValueCandidate = ArticleListItemRow & {
  _sort_published_at: string | null
  full_text: string | null
  notification_body_text: string | null
  frequency_quantile: number
  priority_level: number
  articles_per_week: number
  feed_history_count: number
  feed_read_count: number
  feed_bookmark_count: number
  feed_like_count: number
  category_history_count: number
  category_read_count: number
  category_bookmark_count: number
  category_like_count: number
  feed_affinity_score: number
  category_affinity_score: number
  article_quality_score: number
  freshness_score: number
  high_frequency_penalty: number
  already_covered_penalty: number
  topic_cooldown_penalty: number
  has_read_similar: boolean
  has_cooldown: boolean
  direct_similar_count: number
  inbox_score: number
}

type ArticleDetailRow = ArticleDetail & ArticleListItemRow

function mapArticleListItem(article: ArticleListItemRow): ArticleListItem {
  const {
    _feed_view_type_raw,
    _feed_url,
    _feed_rss_url,
    _feed_rss_bridge_url,
    ...rest
  } = article

  return {
    ...rest,
    has_video: Boolean(article.has_video),
    feed_view_type: resolveFeedViewType({
      view_type: _feed_view_type_raw,
      url: _feed_url,
      rss_url: _feed_rss_url,
      rss_bridge_url: _feed_rss_bridge_url,
    }),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100
}

function dedupeStrings(values: string[], limit?: number): string[] {
  const deduped = [...new Set(values)]
  return limit == null ? deduped : deduped.slice(0, limit)
}

function mapPriorityScore(priorityLevel: number): number {
  switch (priorityLevel) {
    case 1:
      return -3
    case 2:
      return -1.5
    case 4:
      return 2.5
    case 5:
      return 5
    default:
      return 0
  }
}

function mapPriorityDiscount(priorityLevel: number): number {
  switch (priorityLevel) {
    case 2:
      return 0.1
    case 3:
      return 0.2
    case 4:
      return 0.4
    case 5:
      return 0.65
    default:
      return 0
  }
}

function computeFrequencyPenalty(articlesPerWeek: number, priorityLevel: number, quantile: number): number {
  const volumePenalty = articlesPerWeek > 20
    ? 1.4 * Math.log2(1 + (articlesPerWeek - 20) / 10)
    : 0
  const quantilePenalty = quantile > 0.8
    ? 1.2 * ((quantile - 0.8) / 0.2)
    : 0
  const rawPenalty = clamp(volumePenalty + quantilePenalty, 0, 6)
  if (rawPenalty === 0) return 0
  const discountedPenalty = rawPenalty * (1 - mapPriorityDiscount(priorityLevel))
  return Math.max(discountedPenalty, rawPenalty * 0.35)
}

function computeFreshnessScore(publishedAt: string | null): number {
  if (!publishedAt) return 0
  const ageMs = Date.now() - new Date(publishedAt).getTime()
  if (ageMs <= 12 * 60 * 60 * 1000) return 2.4
  if (ageMs <= 48 * 60 * 60 * 1000) return 1.4
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 0.6
  return 0
}

function buildHighValueReasons(article: HighValueCandidate): InboxReasonCode[] {
  const reasons: InboxReasonCode[] = []

  if (article.priority_level >= 5) {
    reasons.push('manual_priority_must_read')
  } else if (article.priority_level >= 4) {
    reasons.push('feed_priority_high')
  } else if (article.priority_level <= 1) {
    reasons.push('manual_priority_low')
  }

  if (article.feed_affinity_score >= 1.25 || article.category_affinity_score >= 0.9) {
    reasons.push('feed_affinity_high')
  }
  if (article.articles_per_week > 0 && article.articles_per_week <= 20) {
    reasons.push('low_frequency_source')
  }
  if (article.has_read_similar) {
    reasons.push('topic_already_covered')
  }
  if (article.has_cooldown) {
    reasons.push('cooldown_active')
  }
  if (article.article_kind === 'original') {
    reasons.push('original_reporting')
  }
  if (article.direct_similar_count > 0) {
    reasons.push('topic_collapsed')
  }
  if (article.freshness_score >= 1.4) {
    reasons.push('recent_story')
  }

  return dedupeStrings(reasons, HIGH_VALUE_REASON_LIMIT) as InboxReasonCode[]
}

function mapToHighValueArticle(article: HighValueCandidate): HighValueArticle {
  const {
    priority_level: _priority_level,
    articles_per_week: _articles_per_week,
    feed_history_count: _feed_history_count,
    feed_read_count: _feed_read_count,
    feed_bookmark_count: _feed_bookmark_count,
    feed_like_count: _feed_like_count,
    category_history_count: _category_history_count,
    category_read_count: _category_read_count,
    category_bookmark_count: _category_bookmark_count,
    category_like_count: _category_like_count,
    feed_affinity_score: _feed_affinity_score,
    category_affinity_score: _category_affinity_score,
    article_quality_score: _article_quality_score,
    freshness_score: _freshness_score,
    high_frequency_penalty: _high_frequency_penalty,
    already_covered_penalty: _already_covered_penalty,
    topic_cooldown_penalty: _topic_cooldown_penalty,
    has_read_similar: _has_read_similar,
    has_cooldown: _has_cooldown,
    direct_similar_count: _direct_similar_count,
    _sort_published_at: _sort_published_at,
    ...rest
  } = article

  return {
    ...rest,
    inbox_score: roundScore(article.inbox_score ?? 0),
    inbox_reason_codes: buildHighValueReasons(article),
  }
}

function mapArticleDetail(article: ArticleDetailRow | undefined): ArticleDetail | undefined {
  return article ? {
    ...mapArticleListItem(article),
    full_text: article.full_text,
    full_text_translated: article.full_text_translated,
    translated_lang: article.translated_lang,
    images_archived_at: article.images_archived_at,
    feed_type: article.feed_type,
    imageArchivingEnabled: article.imageArchivingEnabled,
  } : undefined
}

// --- Score computation ---

const SCORE_DECAY_FACTOR = 0.05
const SEARCH_BOOST_FACTOR = 5.0

/**
 * Build the engagement × decay score SQL expression.
 * @param prefix - table alias (e.g. 'a.') for JOIN queries, or '' for single-table UPDATE
 */
function scoreExpr(prefix: string, opts?: { searchBoost?: boolean }): string {
  const p = prefix
  const engagement = `(
    (CASE WHEN ${p}liked_at IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN ${p}bookmarked_at IS NOT NULL THEN 5 ELSE 0 END)
    + (CASE WHEN ${p}full_text_translated IS NOT NULL THEN 3 ELSE 0 END)
    + (CASE WHEN ${p}read_at IS NOT NULL THEN 2 ELSE 0 END)
  )`
  const decay = `(1.0 / (1.0 + (julianday('now') - julianday(
    COALESCE(${p}read_at, ${p}published_at, ${p}fetched_at)
  )) * ${SCORE_DECAY_FACTOR}))`
  const boost = opts?.searchBoost ? ` * ${SEARCH_BOOST_FACTOR}` : ''
  return `(${engagement} * ${decay}${boost})`
}

// Inbox triage priorities:
// explicit engagement > feed affinity > category affinity > content readiness > kind bias > recency
const INBOX_SCORE_LIKE_BOOST = 12
const INBOX_SCORE_BOOKMARK_BOOST = 10
// Rare but intentional: unread items can already be machine-translated before the user opens them.
const INBOX_SCORE_TRANSLATION_BOOST = 6
const INBOX_SCORE_HISTORY_READ_WEIGHT = 1
const INBOX_SCORE_HISTORY_BOOKMARK_WEIGHT = 3
const INBOX_SCORE_HISTORY_LIKE_WEIGHT = 5
const INBOX_SCORE_FEED_DAMPING = 8
const INBOX_SCORE_FEED_AFFINITY_MULTIPLIER = 8
const INBOX_SCORE_CATEGORY_DAMPING = 12
const INBOX_SCORE_CATEGORY_AFFINITY_MULTIPLIER = 5
const INBOX_SCORE_SIMILAR_COUNT_CAP = 3
const INBOX_SCORE_SIMILAR_ARTICLE_BOOST = 1.5
const INBOX_SCORE_SUMMARY_OR_EXCERPT_BOOST = 1
const INBOX_SCORE_FULL_TEXT_BOOST = 0.75
const INBOX_SCORE_NOTIFICATION_BODY_BOOST = 0.5
const INBOX_SCORE_ORIGINAL_KIND_BOOST = 0.75
const INBOX_SCORE_QUOTE_KIND_BOOST = 0.25
const INBOX_SCORE_REPOST_KIND_BOOST = -0.75
const INBOX_SCORE_RECENT_12H_BOOST = 2.5
const INBOX_SCORE_RECENT_48H_BOOST = 1.5
const INBOX_SCORE_RECENT_7D_BOOST = 0.5
const INBOX_SCORE_HISTORY_WINDOW_DAYS = 90
const HIGH_VALUE_HISTORY_WINDOW_DAYS = 90
const HIGH_VALUE_CANDIDATE_LOOKBACK_DAYS = 7
const HIGH_VALUE_CANDIDATE_MULTIPLIER = 6
const HIGH_VALUE_CANDIDATE_MIN_LIMIT = 30
const HIGH_VALUE_DEFAULT_LIMIT = 10
const HIGH_VALUE_MAX_LIMIT = 20
const HIGH_VALUE_FEED_AFFINITY_DENOMINATOR = 12
const HIGH_VALUE_FEED_AFFINITY_MAX = 3
const HIGH_VALUE_FEED_AFFINITY_MULTIPLIER = 6
const HIGH_VALUE_CATEGORY_AFFINITY_DENOMINATOR = 20
const HIGH_VALUE_CATEGORY_AFFINITY_MAX = 1.5
const HIGH_VALUE_CATEGORY_AFFINITY_MULTIPLIER = 3
const HIGH_VALUE_TOPIC_ALREADY_COVERED_PENALTY = 2
const HIGH_VALUE_TOPIC_COOLDOWN_PENALTY = 4
const HIGH_VALUE_REASON_LIMIT = 2

function inboxScoreExpr(
  prefix: string,
  opts: {
    feedHistoryAlias: string
    categoryHistoryAlias: string
    similarAlias: string
  },
): string {
  const p = prefix
  const { feedHistoryAlias: fh, categoryHistoryAlias: ch, similarAlias: sim } = opts

  return `(
    (CASE WHEN ${p}liked_at IS NOT NULL THEN ${INBOX_SCORE_LIKE_BOOST} ELSE 0 END)
    + (CASE WHEN ${p}bookmarked_at IS NOT NULL THEN ${INBOX_SCORE_BOOKMARK_BOOST} ELSE 0 END)
    + (CASE WHEN ${p}full_text_translated IS NOT NULL THEN ${INBOX_SCORE_TRANSLATION_BOOST} ELSE 0 END)
    + (
      COALESCE(
        (
          ((${fh}.read_count * ${INBOX_SCORE_HISTORY_READ_WEIGHT}.0)
          + (${fh}.bookmark_count * ${INBOX_SCORE_HISTORY_BOOKMARK_WEIGHT}.0)
          + (${fh}.like_count * ${INBOX_SCORE_HISTORY_LIKE_WEIGHT}.0))
          / (${fh}.article_count + ${INBOX_SCORE_FEED_DAMPING}.0)
        ) * ${INBOX_SCORE_FEED_AFFINITY_MULTIPLIER}.0,
        0
      )
    )
    + (
      COALESCE(
        (
          ((${ch}.read_count * ${INBOX_SCORE_HISTORY_READ_WEIGHT}.0)
          + (${ch}.bookmark_count * ${INBOX_SCORE_HISTORY_BOOKMARK_WEIGHT}.0)
          + (${ch}.like_count * ${INBOX_SCORE_HISTORY_LIKE_WEIGHT}.0))
          / (${ch}.article_count + ${INBOX_SCORE_CATEGORY_DAMPING}.0)
        ) * ${INBOX_SCORE_CATEGORY_AFFINITY_MULTIPLIER}.0,
        0
      )
    )
    + (MIN(COALESCE(${sim}.similar_count, 0), ${INBOX_SCORE_SIMILAR_COUNT_CAP}) * ${INBOX_SCORE_SIMILAR_ARTICLE_BOOST})
    + (CASE WHEN ${p}summary IS NOT NULL OR ${p}excerpt IS NOT NULL THEN ${INBOX_SCORE_SUMMARY_OR_EXCERPT_BOOST} ELSE 0 END)
    + (CASE WHEN ${p}full_text IS NOT NULL THEN ${INBOX_SCORE_FULL_TEXT_BOOST} ELSE 0 END)
    + (CASE WHEN ${p}notification_body_text IS NOT NULL THEN ${INBOX_SCORE_NOTIFICATION_BODY_BOOST} ELSE 0 END)
    + (CASE
        WHEN ${p}article_kind = 'original' THEN ${INBOX_SCORE_ORIGINAL_KIND_BOOST}
        WHEN ${p}article_kind = 'quote' THEN ${INBOX_SCORE_QUOTE_KIND_BOOST}
        WHEN ${p}article_kind = 'repost' THEN ${INBOX_SCORE_REPOST_KIND_BOOST}
        ELSE 0
      END)
    + (CASE
        WHEN julianday(COALESCE(${p}published_at, ${p}fetched_at)) >= julianday('now', '-12 hours') THEN ${INBOX_SCORE_RECENT_12H_BOOST}
        WHEN julianday(COALESCE(${p}published_at, ${p}fetched_at)) >= julianday('now', '-48 hours') THEN ${INBOX_SCORE_RECENT_48H_BOOST}
        WHEN julianday(COALESCE(${p}published_at, ${p}fetched_at)) >= julianday('now', '-7 days') THEN ${INBOX_SCORE_RECENT_7D_BOOST}
        ELSE 0
      END)
  )`
}

/** WHERE clause for articles that have engagement or a non-zero score. Shared with search sync. */
export const SCORED_ARTICLES_WHERE = `(
  liked_at IS NOT NULL
  OR bookmarked_at IS NOT NULL
  OR read_at IS NOT NULL
  OR full_text_translated IS NOT NULL
  OR score > 0
)`

/** Update score in DB and sync to search. Call within a transaction for atomicity. */
function updateScoreDb(id: number): void {
  getDb().prepare(`UPDATE articles SET score = (${scoreExpr('')}) WHERE id = ?`).run(id)
}

function syncScoreToSearch(id: number): void {
  const row = getDb().prepare('SELECT score FROM articles WHERE id = ?').get(id) as { score: number } | undefined
  if (row) syncArticleScoreToSearch(id, row.score)
}

export function updateScore(id: number): void {
  updateScoreDb(id)
  syncScoreToSearch(id)
}

export function recalculateScores(): { updated: number } {
  const result = getDb().prepare(`
    UPDATE articles SET score = (${scoreExpr('')})
    WHERE id IN (SELECT id FROM active_articles) AND ${SCORED_ARTICLES_WHERE}
  `).run()
  return { updated: result.changes }
}

// --- Article list queries ---

export function getArticles(opts: {
  feedId?: number
  categoryId?: number
  feedViewType?: FeedViewType
  articleKind?: ArticleKind
  unread?: boolean
  bookmarked?: boolean
  liked?: boolean
  read?: boolean
  since?: string
  until?: string
  sort?: 'score' | 'oldest_unread' | 'inbox_score'
  excludeIds?: number[]
  limit: number
  offset: number
  smartFloor?: boolean
  userId?: number | null
}): { articles: ArticleListItem[]; total: number; totalWithoutFloor?: number } {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  const scopedUserId = resolveUserId(opts.userId)

  if (scopedUserId != null) {
    conditions.push('a.user_id = @userId')
    params.userId = scopedUserId
  }

  if (opts.feedId) {
    conditions.push('a.feed_id = @feedId')
    params.feedId = opts.feedId
  }
  if (opts.categoryId) {
    conditions.push('a.category_id = @categoryId')
    params.categoryId = opts.categoryId
  }
  if (opts.feedViewType) {
    conditions.push(`${resolvedFeedViewTypeExpr('f')} = @feedViewType`)
    params.feedViewType = opts.feedViewType
  }
  if (opts.articleKind) {
    conditions.push('a.article_kind = @articleKind')
    params.articleKind = opts.articleKind
  }
  if (opts.unread) {
    conditions.push('a.seen_at IS NULL')
  }
  if (opts.bookmarked) {
    conditions.push('a.bookmarked_at IS NOT NULL')
  }
  if (opts.liked) {
    conditions.push('a.liked_at IS NOT NULL')
  }
  if (opts.read) {
    conditions.push('a.read_at IS NOT NULL')
  }
  if (opts.since) {
    conditions.push('COALESCE(a.published_at, a.fetched_at) >= @since')
    params.since = opts.since
  }
  if (opts.until) {
    conditions.push('COALESCE(a.published_at, a.fetched_at) <= @until')
    params.until = opts.until
  }
  if (opts.excludeIds?.length) {
    const placeholders = opts.excludeIds.map((_, index) => `@excludeId_${index}`).join(', ')
    conditions.push(`a.id NOT IN (${placeholders})`)
    opts.excludeIds.forEach((id, index) => {
      params[`excludeId_${index}`] = id
    })
  }

  // Smart floor: limit the displayed range to keep lists manageable.
  // Pick the floor that yields the MOST articles (= earliest date) among:
  //   1. SMART_FLOOR_DAYS ago
  //   2. SMART_FLOOR_MIN_ARTICLES-th newest article's date
  //   3. Oldest unread article's date (if any)
  const SMART_FLOOR_DAYS = 7
  const SMART_FLOOR_MIN_ARTICLES = 20

  let floorApplied = false

  if (opts.smartFloor && !opts.since && !opts.until) {
    const scopeWhere = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // Candidate 1: SMART_FLOOR_DAYS ago
    const floorAgo = new Date(Date.now() - SMART_FLOOR_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Candidate 2: SMART_FLOOR_MIN_ARTICLES-th newest article's date
    const top20Row = getNamed<{ floor: string | null }>(`
      SELECT a.published_at AS floor FROM active_articles a
      JOIN feeds f ON a.feed_id = f.id
      ${scopeWhere}
      ORDER BY a.published_at DESC
      LIMIT 1 OFFSET ${SMART_FLOOR_MIN_ARTICLES - 1}
    `, params)

    // Candidate 3: oldest unread article's date
    const unreadRow = getNamed<{ floor: string | null }>(`
      SELECT MIN(a.published_at) AS floor FROM active_articles a
      JOIN feeds f ON a.feed_id = f.id
      ${scopeWhere ? scopeWhere + ' AND' : 'WHERE'} a.seen_at IS NULL AND a.published_at IS NOT NULL
    `, params)

    // If fewer than SMART_FLOOR_MIN_ARTICLES exist, skip the floor entirely — show all
    if (!top20Row?.floor) {
      // no-op: don't add a date condition
    } else {
      // Pick the earliest (= shows the most articles)
      const candidates: string[] = [floorAgo, top20Row.floor]
      if (unreadRow?.floor) candidates.push(unreadRow.floor)
      const smartFloorDate = candidates.sort()[0]

      conditions.push('(a.published_at IS NULL OR a.published_at >= @smartFloorDate)')
      params.smartFloorDate = smartFloorDate
      floorApplied = true
    }
  }

  // Count without floor for "show more" UI
  const baseWhere = floorApplied
    ? (() => {
        const baseConditions = conditions.filter(c => !c.includes('@smartFloorDate'))
        return baseConditions.length > 0 ? 'WHERE ' + baseConditions.join(' AND ') : ''
      })()
    : undefined

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  const inboxHistoryCtes = opts.sort === 'inbox_score'
    ? `
      WITH feed_history AS (
        -- Include all articles in the ${INBOX_SCORE_HISTORY_WINDOW_DAYS}-day window so affinity reflects
        -- consumption rate, not just absolute engaged volume.
        SELECT
          h.feed_id,
          COUNT(*) AS article_count,
          COUNT(CASE WHEN h.read_at IS NOT NULL THEN 1 END) AS read_count,
          COUNT(CASE WHEN h.bookmarked_at IS NOT NULL THEN 1 END) AS bookmark_count,
          COUNT(CASE WHEN h.liked_at IS NOT NULL THEN 1 END) AS like_count
        FROM active_articles h
        JOIN feeds hf ON h.feed_id = hf.id
        WHERE hf.type != 'clip'
          AND julianday(COALESCE(h.published_at, h.fetched_at)) >= julianday('now', '-${INBOX_SCORE_HISTORY_WINDOW_DAYS} days')
          ${scopedUserId == null ? '' : 'AND h.user_id = @userId'}
        GROUP BY h.feed_id
      ),
      category_history AS (
        -- Same denominator as feed_history: all articles in the window, not only engaged items.
        SELECT
          h.category_id,
          COUNT(*) AS article_count,
          COUNT(CASE WHEN h.read_at IS NOT NULL THEN 1 END) AS read_count,
          COUNT(CASE WHEN h.bookmarked_at IS NOT NULL THEN 1 END) AS bookmark_count,
          COUNT(CASE WHEN h.liked_at IS NOT NULL THEN 1 END) AS like_count
        FROM active_articles h
        JOIN feeds hf ON h.feed_id = hf.id
        WHERE hf.type != 'clip'
          AND h.category_id IS NOT NULL
          AND julianday(COALESCE(h.published_at, h.fetched_at)) >= julianday('now', '-${INBOX_SCORE_HISTORY_WINDOW_DAYS} days')
          ${scopedUserId == null ? '' : 'AND h.user_id = @userId'}
        GROUP BY h.category_id
      )
    `
    : ''
  const inboxHistoryJoins = opts.sort === 'inbox_score'
    ? `
      LEFT JOIN feed_history fh ON fh.feed_id = a.feed_id
      LEFT JOIN category_history ch ON ch.category_id = a.category_id
    `
    : ''
  const inboxScoreSelect = opts.sort === 'inbox_score'
    ? `${inboxScoreExpr('a.', { feedHistoryAlias: 'fh', categoryHistoryAlias: 'ch', similarAlias: 'sim' })} AS inbox_score,`
    : 'NULL AS inbox_score,'
  const similarCountSelect = opts.sort === 'inbox_score'
    ? 'COALESCE(sim.similar_count, 0) AS similar_count'
    : '(SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count'
  const similarCountJoin = opts.sort === 'inbox_score'
    ? `
      LEFT JOIN (
        SELECT article_id, COUNT(*) AS similar_count
        FROM article_similarities
        GROUP BY article_id
      ) sim ON sim.article_id = a.id
    `
    : ''
  const orderBy = opts.sort === 'score'
    ? 'a.score DESC, a.published_at DESC'
    : opts.sort === 'inbox_score'
        ? 'inbox_score DESC, COALESCE(a.published_at, a.fetched_at) DESC, a.id DESC'
        : opts.sort === 'oldest_unread'
          ? "CASE WHEN a.seen_at IS NULL THEN 0 ELSE 1 END, COALESCE(a.published_at, a.fetched_at) ASC"
          : opts.liked ? 'a.liked_at DESC' : opts.read ? 'a.read_at DESC' : 'a.published_at DESC'

  const totalRow = getNamed<{ cnt: number }>(`
    SELECT COUNT(*) AS cnt
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
  `, params)
  const total = totalRow.cnt

  const totalWithoutFloor = baseWhere != null
    ? getNamed<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt
      FROM active_articles a
      JOIN feeds f ON a.feed_id = f.id
      ${baseWhere}
    `, params).cnt
    : undefined

  const articles = allNamed<ArticleListItem>(`
    ${inboxHistoryCtes}
    SELECT a.id, a.feed_id, f.name AS feed_name, f.icon_url AS feed_icon_url,
           f.view_type AS _feed_view_type_raw, f.url AS _feed_url, f.rss_url AS _feed_rss_url, f.rss_bridge_url AS _feed_rss_bridge_url,
           a.title, a.url, a.article_kind, a.published_at, a.lang, a.summary, a.excerpt, a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           ${hasVideoExpr('a.')} AS has_video,
           ${inboxScoreSelect}
           a.score,
           ${similarCountSelect}
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${similarCountJoin}
    ${inboxHistoryJoins}
    ${where}
    ORDER BY ${orderBy}
    LIMIT @_limit OFFSET @_offset
  `, { ...params, _limit: Number(opts.limit), _offset: Number(opts.offset) }).map((row) => mapArticleListItem(row as ArticleListItemRow))

  return { articles, total, ...(totalWithoutFloor != null && totalWithoutFloor > total ? { totalWithoutFloor } : {}) }
}

export function getInboxSummary(userId?: number | null): InboxSummary {
  const scopedUserId = resolveUserId(userId)
  const row = getNamed<InboxSummary>(`
    SELECT
      COUNT(*) AS unread_total,
      COUNT(CASE WHEN a.published_at >= date('now', 'start of day') THEN 1 END) AS new_today,
      MIN(a.published_at) AS oldest_unread_at,
      COUNT(DISTINCT a.feed_id) AS source_feed_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.seen_at IS NULL
      AND f.type != 'clip'
      ${scopedUserId == null ? '' : 'AND a.user_id = @userId'}
  `, scopedUserId == null ? {} : { userId: scopedUserId })

  return {
    unread_total: row?.unread_total ?? 0,
    new_today: row?.new_today ?? 0,
    oldest_unread_at: row?.oldest_unread_at ?? null,
    source_feed_count: row?.source_feed_count ?? 0,
  }
}

export function getHighValueInbox(opts?: {
  limit?: number
  feedViewType?: FeedViewType
  userId?: number | null
}): HighValueResponse {
  const scopedUserId = resolveUserId(opts?.userId)
  const requestedLimit = opts?.limit ?? HIGH_VALUE_DEFAULT_LIMIT
  const limit = clamp(requestedLimit, 1, HIGH_VALUE_MAX_LIMIT)
  const candidateLimit = Math.max(limit * HIGH_VALUE_CANDIDATE_MULTIPLIER, HIGH_VALUE_CANDIDATE_MIN_LIMIT)
  const cooldowns = listActiveInboxTopicCooldowns(scopedUserId)
  const cooldownAnchorIds = cooldowns.map((cooldown) => cooldown.anchor_article_id)
  const cooldownPlaceholders = cooldownAnchorIds.map((_, index) => `@cooldown_anchor_${index}`).join(', ')
  const params: Record<string, unknown> = {
    candidateLimit,
  }

  if (scopedUserId != null) {
    params.userId = scopedUserId
  }
  cooldownAnchorIds.forEach((id, index) => {
    params[`cooldown_anchor_${index}`] = id
  })
  if (opts?.feedViewType) {
    params.feedViewType = opts.feedViewType
  }

  const feedViewFilter = opts?.feedViewType
    ? `AND ${resolvedFeedViewTypeExpr('f')} = @feedViewType`
    : ''
  const cooldownExistsExpr = cooldownAnchorIds.length > 0
    ? `(
        a.id IN (${cooldownPlaceholders})
        OR EXISTS (
        SELECT 1
        FROM article_similarities cooldown_sim
        WHERE cooldown_sim.article_id = a.id
          AND cooldown_sim.similar_to_id IN (${cooldownPlaceholders})
      ))`
    : '0'

  const frequencyValues = allNamed<{ articles_per_week: number }>(`
    SELECT
      COUNT(
        CASE
          WHEN COALESCE(a.published_at, a.fetched_at) >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-28 days')
          THEN 1
        END
      ) / 4.0 AS articles_per_week
    FROM feeds f
    LEFT JOIN active_articles a ON a.feed_id = f.id
    WHERE f.type != 'clip'
      ${scopedUserId == null ? '' : 'AND f.user_id = @userId'}
    GROUP BY f.id
  `, scopedUserId == null ? {} : { userId: scopedUserId })
  const sortedFrequencyValues = frequencyValues
    .map((item) => item.articles_per_week)
    .sort((left, right) => left - right)

  const candidates = allNamed<HighValueCandidate>(`
    WITH feed_history AS (
      SELECT
        h.feed_id,
        COUNT(*) AS article_count,
        COUNT(CASE WHEN h.read_at IS NOT NULL THEN 1 END) AS read_count,
        COUNT(CASE WHEN h.bookmarked_at IS NOT NULL THEN 1 END) AS bookmark_count,
        COUNT(CASE WHEN h.liked_at IS NOT NULL THEN 1 END) AS like_count
      FROM active_articles h
      JOIN feeds hf ON h.feed_id = hf.id
      WHERE hf.type != 'clip'
        AND julianday(COALESCE(h.published_at, h.fetched_at)) >= julianday('now', '-${HIGH_VALUE_HISTORY_WINDOW_DAYS} days')
        ${scopedUserId == null ? '' : 'AND h.user_id = @userId'}
      GROUP BY h.feed_id
    ),
    category_history AS (
      SELECT
        h.category_id,
        COUNT(*) AS article_count,
        COUNT(CASE WHEN h.read_at IS NOT NULL THEN 1 END) AS read_count,
        COUNT(CASE WHEN h.bookmarked_at IS NOT NULL THEN 1 END) AS bookmark_count,
        COUNT(CASE WHEN h.liked_at IS NOT NULL THEN 1 END) AS like_count
      FROM active_articles h
      JOIN feeds hf ON h.feed_id = hf.id
      WHERE hf.type != 'clip'
        AND h.category_id IS NOT NULL
        AND julianday(COALESCE(h.published_at, h.fetched_at)) >= julianday('now', '-${HIGH_VALUE_HISTORY_WINDOW_DAYS} days')
        ${scopedUserId == null ? '' : 'AND h.user_id = @userId'}
      GROUP BY h.category_id
    ),
    feed_frequency AS (
      SELECT
        f.id AS feed_id,
        COUNT(
          CASE
            WHEN COALESCE(fa.published_at, fa.fetched_at) >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-28 days')
            THEN 1
          END
        ) / 4.0 AS articles_per_week
      FROM feeds f
      LEFT JOIN active_articles fa ON fa.feed_id = f.id
      WHERE f.type != 'clip'
        ${scopedUserId == null ? '' : 'AND f.user_id = @userId'}
      GROUP BY f.id
    ),
    direct_similar AS (
      SELECT article_id, COUNT(*) AS direct_similar_count
      FROM article_similarities
      GROUP BY article_id
    ),
    read_similar AS (
      SELECT s.article_id, 1 AS has_read_similar
      FROM article_similarities s
      JOIN active_articles similar ON similar.id = s.similar_to_id
      WHERE similar.read_at IS NOT NULL
        ${scopedUserId == null ? '' : 'AND similar.user_id = @userId'}
      GROUP BY s.article_id
    )
    SELECT
      a.id,
      a.feed_id,
      f.name AS feed_name,
      f.icon_url AS feed_icon_url,
      f.view_type AS _feed_view_type_raw,
      f.url AS _feed_url,
      f.rss_url AS _feed_rss_url,
      f.rss_bridge_url AS _feed_rss_bridge_url,
      a.title,
      a.url,
      a.article_kind,
      a.published_at,
      a.lang,
      a.summary,
      a.excerpt,
      a.full_text,
      a.notification_body_text,
      a.og_image,
      a.seen_at,
      a.read_at,
      a.bookmarked_at,
      a.liked_at,
      ${hasVideoExpr('a.')} AS has_video,
      COALESCE(a.published_at, a.fetched_at) AS _sort_published_at,
      f.priority_level,
      COALESCE(ff.articles_per_week, 0) AS articles_per_week,
      COALESCE(fh.article_count, 0) AS feed_history_count,
      COALESCE(fh.read_count, 0) AS feed_read_count,
      COALESCE(fh.bookmark_count, 0) AS feed_bookmark_count,
      COALESCE(fh.like_count, 0) AS feed_like_count,
      COALESCE(ch.article_count, 0) AS category_history_count,
      COALESCE(ch.read_count, 0) AS category_read_count,
      COALESCE(ch.bookmark_count, 0) AS category_bookmark_count,
      COALESCE(ch.like_count, 0) AS category_like_count,
      0 AS frequency_quantile,
      0 AS feed_affinity_score,
      0 AS category_affinity_score,
      0 AS article_quality_score,
      0 AS freshness_score,
      0 AS high_frequency_penalty,
      CASE WHEN rs.has_read_similar = 1 THEN ${HIGH_VALUE_TOPIC_ALREADY_COVERED_PENALTY} ELSE 0 END AS already_covered_penalty,
      CASE WHEN ${cooldownExistsExpr} THEN ${HIGH_VALUE_TOPIC_COOLDOWN_PENALTY} ELSE 0 END AS topic_cooldown_penalty,
      COALESCE(rs.has_read_similar, 0) AS has_read_similar,
      CASE WHEN ${cooldownExistsExpr} THEN 1 ELSE 0 END AS has_cooldown,
      COALESCE(ds.direct_similar_count, 0) AS direct_similar_count,
      0 AS inbox_score,
      a.score
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    LEFT JOIN feed_history fh ON fh.feed_id = a.feed_id
    LEFT JOIN category_history ch ON ch.category_id = a.category_id
    LEFT JOIN feed_frequency ff ON ff.feed_id = a.feed_id
    LEFT JOIN direct_similar ds ON ds.article_id = a.id
    LEFT JOIN read_similar rs ON rs.article_id = a.id
    WHERE a.seen_at IS NULL
      AND f.type != 'clip'
      AND julianday(COALESCE(a.published_at, a.fetched_at)) >= julianday('now', '-${HIGH_VALUE_CANDIDATE_LOOKBACK_DAYS} days')
      ${scopedUserId == null ? '' : 'AND a.user_id = @userId'}
      ${feedViewFilter}
    ORDER BY COALESCE(a.published_at, a.fetched_at) DESC, a.id DESC
    LIMIT @candidateLimit
  `, params).map((row) => {
    const feedAffinityRatio = ((row.feed_read_count * 1) + (row.feed_bookmark_count * 3) + (row.feed_like_count * 5))
      / (row.feed_history_count + HIGH_VALUE_FEED_AFFINITY_DENOMINATOR)
    const categoryAffinityRatio = ((row.category_read_count * 1) + (row.category_bookmark_count * 2) + (row.category_like_count * 3))
      / (row.category_history_count + HIGH_VALUE_CATEGORY_AFFINITY_DENOMINATOR)
    const feedAffinityScore = Math.min(HIGH_VALUE_FEED_AFFINITY_MAX, HIGH_VALUE_FEED_AFFINITY_MULTIPLIER * feedAffinityRatio)
    const categoryAffinityScore = Math.min(HIGH_VALUE_CATEGORY_AFFINITY_MAX, HIGH_VALUE_CATEGORY_AFFINITY_MULTIPLIER * categoryAffinityRatio)
    const articleQualityScore =
      (row.full_text ? 1 : 0)
      + ((row.summary || row.excerpt) ? 0.6 : 0)
      + (row.notification_body_text ? 0.2 : 0)
      + (row.article_kind === 'original' ? 0.8 : row.article_kind === 'quote' ? 0.2 : row.article_kind === 'repost' ? -0.5 : 0)
    const freshnessScore = computeFreshnessScore(row._sort_published_at)
    const lessOrEqualCount = sortedFrequencyValues.filter((value) => value <= row.articles_per_week).length
    const frequencyQuantile = row.frequency_quantile || (sortedFrequencyValues.length > 0 ? lessOrEqualCount / sortedFrequencyValues.length : 0)
    const highFrequencyPenalty = computeFrequencyPenalty(row.articles_per_week, row.priority_level, frequencyQuantile)
    const inboxScore =
      mapPriorityScore(row.priority_level)
      + feedAffinityScore
      + categoryAffinityScore
      + articleQualityScore
      + freshnessScore
      - highFrequencyPenalty
      - row.already_covered_penalty
      - row.topic_cooldown_penalty

    return {
      ...row,
      has_read_similar: Boolean(row.has_read_similar),
      has_cooldown: Boolean(row.has_cooldown),
      feed_affinity_score: feedAffinityScore,
      category_affinity_score: categoryAffinityScore,
      article_quality_score: articleQualityScore,
      freshness_score: freshnessScore,
      high_frequency_penalty: highFrequencyPenalty,
      inbox_score: inboxScore,
    }
  })

  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const candidateIds = candidates.map((candidate) => candidate.id)
  if (candidateIds.length === 0) {
    return { items: [], represented_article_ids: [] }
  }

  const placeholders = candidateIds.map((_, index) => `@candidate_id_${index}`).join(', ')
  const similarityParams: Record<string, unknown> = {}
  candidateIds.forEach((id, index) => {
    similarityParams[`candidate_id_${index}`] = id
  })

  const similarityRows = allNamed<{ article_id: number; similar_to_id: number }>(`
    SELECT article_id, similar_to_id
    FROM article_similarities
    WHERE article_id IN (${placeholders})
      AND similar_to_id IN (${placeholders})
  `, similarityParams)

  const adjacency = new Map<number, number[]>()
  for (const row of similarityRows) {
    const current = adjacency.get(row.article_id) ?? []
    current.push(row.similar_to_id)
    adjacency.set(row.article_id, current)
  }

  const sortedCandidates = [...candidates].sort((left, right) => {
    const scoreDiff = (right.inbox_score ?? 0) - (left.inbox_score ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    const timeDiff = new Date(right._sort_published_at ?? 0).getTime() - new Date(left._sort_published_at ?? 0).getTime()
    if (timeDiff !== 0) return timeDiff
    return right.id - left.id
  })

  const represented = new Set<number>()
  const items: HighValueResponse['items'] = []

  for (const candidate of sortedCandidates) {
    if (represented.has(candidate.id)) continue

    const directMembers = (adjacency.get(candidate.id) ?? [])
      .map((id) => candidateMap.get(id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .filter((member) => !represented.has(member.id))
      .sort((left, right) => {
        const scoreDiff = (right.inbox_score ?? 0) - (left.inbox_score ?? 0)
        if (scoreDiff !== 0) return scoreDiff
        const timeDiff = new Date(right._sort_published_at ?? 0).getTime() - new Date(left._sort_published_at ?? 0).getTime()
        if (timeDiff !== 0) return timeDiff
        return right.id - left.id
      })

    const groupMembers = [candidate, ...directMembers]
    groupMembers.forEach((member) => represented.add(member.id))

    if (groupMembers.length === 1) {
      items.push({
        kind: 'article',
        display_article: mapToHighValueArticle(candidate),
      })
    } else {
      const sourceNames = dedupeStrings(groupMembers.map((member) => member.feed_name), 3)
      items.push({
        kind: 'group',
        anchor_article_id: candidate.id,
        display_article: mapToHighValueArticle(candidate),
        similar_count: groupMembers.length - 1,
        source_names: sourceNames,
        members: groupMembers.map((member) => mapToHighValueArticle(member)),
      })
    }

    if (items.length >= limit) break
  }

  const representedArticleIds = items.flatMap((item) => item.kind === 'group'
    ? [item.anchor_article_id, ...item.members.map((member) => member.id)]
    : [item.display_article.id])

  return {
    items,
    represented_article_ids: [...new Set(representedArticleIds)],
  }
}

export function getArticleByUrl(url: string, userId?: number | null): ArticleDetail | undefined {
  const scopedUserId = resolveUserId(userId)
  return mapArticleDetail(getDb().prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.icon_url AS feed_icon_url, f.type AS feed_type,
           f.view_type AS _feed_view_type_raw, f.url AS _feed_url, f.rss_url AS _feed_rss_url, f.rss_bridge_url AS _feed_rss_bridge_url,
           a.title, a.url, a.article_kind, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
           ${hasVideoExpr('a.')} AS has_video,
           a.full_text, a.full_text_translated, a.translated_lang, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.images_archived_at,
            (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.url = ?
      ${scopedUserId == null ? '' : 'AND a.user_id = ?'}
  `).get(...(scopedUserId == null ? [normalizeUrl(url)] : [normalizeUrl(url), scopedUserId])) as ArticleDetailRow | undefined)
}

export function getArticleById(id: number, userId?: number | null): ArticleDetail | undefined {
  const scopedUserId = resolveUserId(userId)
  return mapArticleDetail(getDb().prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.icon_url AS feed_icon_url, f.type AS feed_type,
           f.view_type AS _feed_view_type_raw, f.url AS _feed_url, f.rss_url AS _feed_rss_url, f.rss_bridge_url AS _feed_rss_bridge_url,
           a.title, a.url, a.article_kind, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
           ${hasVideoExpr('a.')} AS has_video,
           a.full_text, a.full_text_translated, a.translated_lang, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.images_archived_at,
            (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.id = ?
      ${scopedUserId == null ? '' : 'AND a.user_id = ?'}
  `).get(...(scopedUserId == null ? [id] : [id, scopedUserId])) as ArticleDetailRow | undefined)
}

export function markArticleSeen(
  id: number,
  seen: boolean,
  userId?: number | null,
): { seen_at: string | null; read_at: string | null } | undefined {
  const scopedUserId = resolveUserId(userId)
  const row = getDb().transaction(() => {
    if (seen) {
      const sql = scopedUserId == null
        ? "UPDATE articles SET seen_at = datetime('now') WHERE id = ? AND seen_at IS NULL"
        : "UPDATE articles SET seen_at = datetime('now') WHERE id = ? AND user_id = ? AND seen_at IS NULL"
      getDb().prepare(sql).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
    } else {
      const sql = scopedUserId == null
        ? 'UPDATE articles SET seen_at = NULL, read_at = NULL WHERE id = ?'
        : 'UPDATE articles SET seen_at = NULL, read_at = NULL WHERE id = ? AND user_id = ?'
      getDb().prepare(sql).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
    }
    const sql = scopedUserId == null
      ? 'SELECT seen_at, read_at FROM articles WHERE id = ?'
      : 'SELECT seen_at, read_at FROM articles WHERE id = ? AND user_id = ?'
    return getDb().prepare(sql).get(...(scopedUserId == null ? [id] : [id, scopedUserId])) as { seen_at: string | null; read_at: string | null } | undefined
  })()
  if (!row) return undefined
  if (!seen) {
    updateScoreDb(id)
    syncScoreToSearch(id)
  }
  syncArticleFiltersToSearch([{ id, is_unread: !seen }])
  return { seen_at: row.seen_at, read_at: row.read_at }
}

export function markArticlesSeen(ids: number[], userId?: number | null): { updated: number } {
  if (ids.length === 0) return { updated: 0 }
  const scopedUserId = resolveUserId(userId)
  const placeholders = ids.map(() => '?').join(',')
  const result = getDb().prepare(
    `UPDATE articles SET seen_at = datetime('now')
     WHERE id IN (${placeholders})
       ${scopedUserId == null ? '' : 'AND user_id = ?'}
       AND seen_at IS NULL`,
  ).run(...ids, ...(scopedUserId == null ? [] : [scopedUserId]))
  if (result.changes > 0) {
    syncArticleFiltersToSearch(ids.map(id => ({ id, is_unread: false })))
  }
  return { updated: result.changes }
}

export function markAllSeenByFeed(feedId: number, userId?: number | null): { updated: number } {
  const scopedUserId = resolveUserId(userId)
  // Collect affected IDs before update for search sync
  const affectedIds = (getDb().prepare(
    `SELECT id FROM active_articles
     WHERE feed_id = ?
       ${scopedUserId == null ? '' : 'AND user_id = ?'}
       AND seen_at IS NULL`,
  ).all(...(scopedUserId == null ? [feedId] : [feedId, scopedUserId])) as { id: number }[]).map(r => r.id)
  const result = getDb().prepare(`
    UPDATE articles
    SET seen_at = datetime('now')
    WHERE feed_id = ?
      ${scopedUserId == null ? '' : 'AND user_id = ?'}
      AND seen_at IS NULL
      AND purged_at IS NULL
  `).run(...(scopedUserId == null ? [feedId] : [feedId, scopedUserId]))
  if (affectedIds.length > 0) {
    syncArticleFiltersToSearch(affectedIds.map(id => ({ id, is_unread: false })))
  }
  return { updated: result.changes }
}

export function markArticleLiked(
  id: number,
  liked: boolean,
  userId?: number | null,
): { liked_at: string | null } | undefined {
  const scopedUserId = resolveUserId(userId)
  const row = getDb().transaction(() => {
    if (liked) {
      const sql = scopedUserId == null
        ? "UPDATE articles SET liked_at = datetime('now') WHERE id = ? AND liked_at IS NULL"
        : "UPDATE articles SET liked_at = datetime('now') WHERE id = ? AND user_id = ? AND liked_at IS NULL"
      getDb().prepare(sql).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
    } else {
      const sql = scopedUserId == null
        ? 'UPDATE articles SET liked_at = NULL WHERE id = ?'
        : 'UPDATE articles SET liked_at = NULL WHERE id = ? AND user_id = ?'
      getDb().prepare(sql).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
    }
    const sql = scopedUserId == null
      ? 'SELECT liked_at FROM articles WHERE id = ?'
      : 'SELECT liked_at FROM articles WHERE id = ? AND user_id = ?'
    return getDb().prepare(sql).get(...(scopedUserId == null ? [id] : [id, scopedUserId])) as { liked_at: string | null } | undefined
  })()
  if (!row) return undefined
  updateScoreDb(id)
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_liked: liked }])
  return { liked_at: row.liked_at }
}

export function getLikeCount(userId?: number | null): number {
  const scopedUserId = resolveUserId(userId)
  const row = getDb().prepare(`
    SELECT COUNT(*) AS cnt
    FROM active_articles
    WHERE liked_at IS NOT NULL
      ${scopedUserId == null ? '' : 'AND user_id = ?'}
  `).get(...(scopedUserId == null ? [] : [scopedUserId])) as { cnt: number }
  return row.cnt
}

export function markArticleBookmarked(
  id: number,
  bookmarked: boolean,
  userId?: number | null,
): { bookmarked_at: string | null } | undefined {
  const scopedUserId = resolveUserId(userId)
  const row = getDb().transaction(() => {
    if (bookmarked) {
      const sql = scopedUserId == null
        ? "UPDATE articles SET bookmarked_at = datetime('now') WHERE id = ? AND bookmarked_at IS NULL"
        : "UPDATE articles SET bookmarked_at = datetime('now') WHERE id = ? AND user_id = ? AND bookmarked_at IS NULL"
      getDb().prepare(sql).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
    } else {
      const sql = scopedUserId == null
        ? 'UPDATE articles SET bookmarked_at = NULL WHERE id = ?'
        : 'UPDATE articles SET bookmarked_at = NULL WHERE id = ? AND user_id = ?'
      getDb().prepare(sql).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
    }
    const sql = scopedUserId == null
      ? 'SELECT bookmarked_at FROM articles WHERE id = ?'
      : 'SELECT bookmarked_at FROM articles WHERE id = ? AND user_id = ?'
    return getDb().prepare(sql).get(...(scopedUserId == null ? [id] : [id, scopedUserId])) as { bookmarked_at: string | null } | undefined
  })()
  if (!row) return undefined
  updateScoreDb(id)
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_bookmarked: bookmarked }])
  return { bookmarked_at: row.bookmarked_at }
}

export function getBookmarkCount(userId?: number | null): number {
  const scopedUserId = resolveUserId(userId)
  const row = getDb().prepare(`
    SELECT COUNT(*) AS cnt
    FROM active_articles
    WHERE bookmarked_at IS NOT NULL
      ${scopedUserId == null ? '' : 'AND user_id = ?'}
  `).get(...(scopedUserId == null ? [] : [scopedUserId])) as { cnt: number }
  return row.cnt
}

export function recordArticleRead(
  id: number,
  userId?: number | null,
): { seen_at: string | null; read_at: string | null } | undefined {
  const scopedUserId = resolveUserId(userId)
  const row = getDb().transaction(() => {
    getDb().prepare(
      `UPDATE articles
       SET read_at = datetime('now'), seen_at = COALESCE(seen_at, datetime('now'))
       WHERE id = ?
         ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
    ).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
    return getDb().prepare(
      `SELECT seen_at, read_at
       FROM articles
       WHERE id = ?
         ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
    ).get(...(scopedUserId == null ? [id] : [id, scopedUserId])) as { seen_at: string | null; read_at: string | null } | undefined
  })()
  if (!row) return undefined
  updateScoreDb(id)
  syncScoreToSearch(id)
  syncArticleFiltersToSearch([{ id, is_unread: false }])
  return { seen_at: row.seen_at, read_at: row.read_at }
}

export function insertArticle(data: {
  feed_id: number
  user_id?: number | null
  title: string
  url: string
  published_at: string | null
  article_kind?: ArticleKind | null
  lang?: string | null
  full_text?: string | null
  full_text_translated?: string | null
  translated_lang?: string | null
  summary?: string | null
  excerpt?: string | null
  og_image?: string | null
  notification_body_text?: string | null
  notification_media_json?: string | null
  notification_media_extracted_at?: string | null
  last_error?: string | null
}): number {
  const inferredUserId = data.user_id
    ?? resolveUserId()
    ?? (getDb().prepare('SELECT user_id FROM feeds WHERE id = ?').get(data.feed_id) as { user_id: number | null } | undefined)?.user_id
  const info = runNamed(`
    INSERT INTO articles (
      user_id, feed_id, category_id, title, url, article_kind, published_at, lang,
      full_text, full_text_translated, translated_lang, summary, excerpt, og_image,
      notification_body_text, notification_media_json, notification_media_extracted_at, last_error
    )
    VALUES (
      @user_id, @feed_id, (SELECT category_id FROM feeds WHERE id = @feed_id), @title, @url, @article_kind, @published_at, @lang,
      @full_text, @full_text_translated, @translated_lang, @summary, @excerpt, @og_image,
      @notification_body_text, @notification_media_json, @notification_media_extracted_at, @last_error
    )
  `, {
    user_id: inferredUserId ?? null,
    feed_id: data.feed_id,
    title: data.title,
    url: normalizeUrl(data.url),
    article_kind: data.article_kind ?? null,
    published_at: data.published_at,
    lang: data.lang ?? null,
    full_text: data.full_text ?? null,
    full_text_translated: data.full_text_translated ?? null,
    translated_lang: data.translated_lang ?? null,
    summary: data.summary ?? null,
    excerpt: data.excerpt ?? null,
    og_image: data.og_image ?? null,
    notification_body_text: data.notification_body_text ?? null,
    notification_media_json: data.notification_media_json ?? null,
    notification_media_extracted_at: data.notification_media_extracted_at ?? null,
    last_error: data.last_error ?? null,
  })
  const articleId = info.lastInsertRowid as number
  const doc = buildMeiliDoc(articleId)
  if (doc) syncArticleToSearch(doc)
  return articleId
}

export function updateArticleContent(
  articleId: number,
  data: {
    article_kind?: ArticleKind | null
    lang?: string | null
    full_text?: string | null
    full_text_translated?: string | null
    translated_lang?: string | null
    summary?: string | null
    excerpt?: string | null
    og_image?: string | null
    notification_body_text?: string | null
    notification_media_json?: string | null
    notification_media_extracted_at?: string | null
    last_error?: string | null
    retry_count?: number
    last_retry_at?: string | null
  },
  userId?: number | null,
): void {
  const scopedUserId = resolveUserId(userId)
  const fields: string[] = []
  const params: Record<string, unknown> = { id: articleId }

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = @${key}`)
      params[key] = val
    }
  }
  if (fields.length === 0) return
  if (scopedUserId != null) {
    params.user_id = scopedUserId
    runNamed(`UPDATE articles SET ${fields.join(', ')} WHERE id = @id AND user_id = @user_id`, params)
  } else {
    runNamed(`UPDATE articles SET ${fields.join(', ')} WHERE id = @id`, params)
  }
  const doc = buildMeiliDoc(articleId)
  if (doc) syncArticleToSearch(doc)
}

export function getExistingArticleUrls(urls: string[], userId?: number | null): Set<string> {
  if (urls.length === 0) return new Set()
  const scopedUserId = resolveUserId(userId)
  const normalized = urls.map(normalizeUrl)
  const placeholders = normalized.map(() => '?').join(',')
  const rows = getDb().prepare(
    `SELECT url FROM articles WHERE url IN (${placeholders}) ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
  ).all(...normalized, ...(scopedUserId == null ? [] : [scopedUserId])) as { url: string }[]
  return new Set(rows.map(r => r.url))
}

export function getExistingArticlesByUrls(urls: string[]): Map<string, { id: number; article_kind: ArticleKind | null }> {
  if (urls.length === 0) return new Map()
  const normalized = urls.map(normalizeUrl)
  const placeholders = normalized.map(() => '?').join(',')
  const rows = getDb().prepare(
    `SELECT id, url, article_kind FROM articles WHERE url IN (${placeholders})`,
  ).all(...normalized) as Array<{ id: number; url: string; article_kind: string | null }>

  return new Map(rows.map(row => [row.url, { id: row.id, article_kind: isArticleKind(row.article_kind) ? row.article_kind : null }]))
}

export function updateArticleKindIfMissing(id: number, articleKind: ArticleKind): boolean {
  const result = getDb().prepare('UPDATE articles SET article_kind = ? WHERE id = ? AND article_kind IS NULL').run(articleKind, id)
  return result.changes > 0
}

export function backfillLegacyXArticleKinds(): { updated: number } {
  const xFeeds = getDb().prepare('SELECT id, url, rss_url, rss_bridge_url FROM feeds').all() as Array<{
    id: number
    url: string | null
    rss_url: string | null
    rss_bridge_url: string | null
  }>
  const xFeedIds = xFeeds.filter(feed => detectArticleKindForFeed(feed, {}) !== null).map(feed => feed.id)
  if (xFeedIds.length === 0) return { updated: 0 }

  const placeholders = xFeedIds.map(() => '?').join(',')
  const rows = getDb().prepare(`
    SELECT id, feed_id, title, excerpt, full_text
    FROM articles
    WHERE article_kind IS NULL
      AND feed_id IN (${placeholders})
  `).all(...xFeedIds) as Array<{
    id: number
    feed_id: number
    title: string
    excerpt: string | null
    full_text: string | null
  }>

  const feedById = new Map(xFeeds.map(feed => [feed.id, feed]))
  const updates: Array<{ id: number; articleKind: ArticleKind }> = []
  for (const row of rows) {
    const feed = feedById.get(row.feed_id)
    if (!feed) continue

    const rawExcerpt = [row.excerpt, row.full_text].filter(Boolean).join('\n')
    const articleKind = detectArticleKindForFeed(feed, { title: row.title, rawExcerpt })
    if (articleKind && articleKind !== 'original') {
      updates.push({ id: row.id, articleKind })
    }
  }

  if (updates.length === 0) return { updated: 0 }

  const txn = getDb().transaction((items: Array<{ id: number; articleKind: ArticleKind }>) => {
    let updated = 0
    const stmt = getDb().prepare('UPDATE articles SET article_kind = ? WHERE id = ? AND article_kind IS NULL')
    for (const item of items) {
      updated += stmt.run(item.articleKind, item.id).changes
    }
    return updated
  })

  return { updated: txn(updates) }
}

// Backoff deadline: datetime when the article becomes eligible for retry again.
// 30 * 2^retry_count minutes, clamped to 32 hours via MIN(retry_count, 6).
const BACKOFF_DEADLINE = `datetime(last_retry_at, '+' || (30 * (1 << MIN(retry_count, 6))) || ' minutes')`

export function getRetryArticles(
  maxAttempts = RETRY_MAX_ATTEMPTS,
  batchLimit = RETRY_BATCH_LIMIT,
): Article[] {
  return getDb().prepare(`
    SELECT * FROM active_articles
    WHERE last_error IS NOT NULL
      AND full_text IS NULL
      AND retry_count < :max_attempts
      AND (
        last_retry_at IS NULL
        OR ${BACKOFF_DEADLINE} <= datetime('now')
      )
    ORDER BY retry_count ASC, last_retry_at ASC
    LIMIT :batch_limit
  `).all({ max_attempts: maxAttempts, batch_limit: batchLimit }) as Article[]
}

export interface RetryStats {
  eligible: number
  backoff_waiting: number
  exceeded: number
}

export function getRetryStats(maxAttempts = RETRY_MAX_ATTEMPTS): RetryStats {
  const row = getDb().prepare(`
    SELECT
      SUM(CASE WHEN retry_count < :max_attempts AND (
        last_retry_at IS NULL
        OR ${BACKOFF_DEADLINE} <= datetime('now')
      ) THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN retry_count < :max_attempts AND
        last_retry_at IS NOT NULL AND
        ${BACKOFF_DEADLINE} > datetime('now')
      THEN 1 ELSE 0 END) AS backoff_waiting,
      SUM(CASE WHEN retry_count >= :max_attempts THEN 1 ELSE 0 END) AS exceeded
    FROM active_articles
    WHERE last_error IS NOT NULL AND full_text IS NULL
  `).get({ max_attempts: maxAttempts }) as { eligible: number | null; backoff_waiting: number | null; exceeded: number | null }
  return {
    eligible: row.eligible ?? 0,
    backoff_waiting: row.backoff_waiting ?? 0,
    exceeded: row.exceeded ?? 0,
  }
}

// --- Search by IDs (Meilisearch integration) ---

export function getArticlesByIds(
  ids: number[],
  opts?: { unread?: boolean; liked?: boolean; bookmarked?: boolean },
  userId?: number | null,
): ArticleListItem[] {
  if (ids.length === 0) return []
  const scopedUserId = resolveUserId(userId)
  const placeholders = ids.map(() => '?').join(',')
  const orderCase = ids.map((id, i) => `WHEN ${id} THEN ${i}`).join(' ')

  const conditions: string[] = [`a.id IN (${placeholders})`]
  if (scopedUserId != null) {
    conditions.push('a.user_id = ?')
  }
  if (opts?.unread !== undefined) {
    conditions.push(opts.unread ? 'a.seen_at IS NULL' : 'a.seen_at IS NOT NULL')
  }
  if (opts?.liked) conditions.push('a.liked_at IS NOT NULL')
  if (opts?.bookmarked) conditions.push('a.bookmarked_at IS NOT NULL')

  const where = 'WHERE ' + conditions.join(' AND ')
  const score = scoreExpr('a.')

  return getDb().prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.icon_url AS feed_icon_url,
           f.view_type AS _feed_view_type_raw, f.url AS _feed_url, f.rss_url AS _feed_rss_url, f.rss_bridge_url AS _feed_rss_bridge_url,
           a.title, a.url, a.article_kind, a.published_at, a.lang, a.summary, a.excerpt,
           a.og_image, ${hasVideoExpr('a.')} AS has_video, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           ${score} AS score
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY CASE a.id ${orderCase} END
  `).all(...ids, ...(scopedUserId == null ? [] : [scopedUserId])).map((row) => mapArticleListItem(row as ArticleListItemRow))
}

// --- Search queries ---

export function searchArticles(opts: {
  query?: string
  feed_id?: number
  category_id?: number
  unread?: boolean
  read?: boolean
  bookmarked?: boolean
  liked?: boolean
  article_kind?: ArticleKind
  article_ids?: number[]
  since?: string
  until?: string
  limit?: number
  sort?: 'published_at' | 'score'
  userId?: number | null
}): ArticleListItem[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  const scopedUserId = resolveUserId(opts.userId)

  if (scopedUserId != null) {
    conditions.push('a.user_id = @user_id')
    params.user_id = scopedUserId
  }

  if (opts.feed_id) {
    conditions.push('a.feed_id = @feed_id')
    params.feed_id = opts.feed_id
  }
  if (opts.category_id) {
    conditions.push('a.category_id = @category_id')
    params.category_id = opts.category_id
  }
  if (opts.article_kind) {
    conditions.push('a.article_kind = @article_kind')
    params.article_kind = opts.article_kind
  }
  if (opts.unread !== undefined) {
    conditions.push(opts.unread ? 'a.seen_at IS NULL' : 'a.seen_at IS NOT NULL')
  }
  if (opts.read !== undefined) {
    conditions.push(opts.read ? 'a.read_at IS NOT NULL' : 'a.read_at IS NULL')
  }
  if (opts.bookmarked) {
    conditions.push('a.bookmarked_at IS NOT NULL')
  }
  if (opts.liked) {
    conditions.push('a.liked_at IS NOT NULL')
  }
  if (opts.article_ids?.length) {
    const placeholders = opts.article_ids.map((_, i) => `@article_id_${i}`).join(', ')
    conditions.push(`a.id IN (${placeholders})`)
    opts.article_ids.forEach((id, i) => { params[`article_id_${i}`] = id })
  } else if (opts.article_ids) {
    return []
  }
  if (opts.since) {
    conditions.push('a.published_at >= @since')
    params.since = opts.since
  }
  if (opts.until) {
    conditions.push('a.published_at <= @until')
    params.until = opts.until
  }

  const hasQuery = !!opts.query

  if (hasQuery) {
    const likePattern = `%${opts.query}%`
    conditions.push('(a.title LIKE @likeQuery OR a.full_text LIKE @likeQuery OR a.full_text_translated LIKE @likeQuery)')
    params.likeQuery = likePattern
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  const limit = opts.limit ?? 20
  const score = scoreExpr('a.', { searchBoost: hasQuery })

  let orderBy: string
  if (opts.sort === 'score') {
    orderBy = `${score} DESC, a.published_at DESC`
  } else if (opts.sort === 'published_at') {
    orderBy = 'a.published_at DESC'
  } else {
    orderBy = hasQuery ? `${score} DESC` : 'a.published_at DESC'
  }

  return allNamed<ArticleListItem>(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.icon_url AS feed_icon_url,
           f.view_type AS _feed_view_type_raw, f.url AS _feed_url, f.rss_url AS _feed_rss_url, f.rss_bridge_url AS _feed_rss_bridge_url,
           a.title, a.url, a.article_kind, a.published_at, a.lang, a.summary, a.excerpt, a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           ${hasVideoExpr('a.')} AS has_video,
           ${score} AS score
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${Number(limit)}
  `, params).map((row) => mapArticleListItem(row as ArticleListItemRow))
}

export function markImagesArchived(articleId: number): void {
  getDb().prepare("UPDATE articles SET images_archived_at = datetime('now') WHERE id = ?").run(articleId)
}

export function clearImagesArchived(articleId: number): void {
  getDb().prepare('UPDATE articles SET images_archived_at = NULL WHERE id = ?').run(articleId)
}

export function deleteArticle(id: number, userId?: number | null): boolean {
  const scopedUserId = resolveUserId(userId)
  const result = getDb().prepare(
    `DELETE FROM articles WHERE id = ? ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
  ).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
  if (result.changes > 0) deleteArticleFromSearch(id)
  return result.changes > 0
}

export function getReadingStats(opts?: {
  since?: string
  until?: string
  userId?: number | null
}): { total: number; read: number; unread: number; by_feed: { feed_id: number; feed_name: string; total: number; read: number; unread: number }[] } {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  const scopedUserId = resolveUserId(opts?.userId)

  if (scopedUserId != null) {
    conditions.push('a.user_id = @user_id')
    params.user_id = scopedUserId
  }

  if (opts?.since) {
    conditions.push('a.published_at >= @since')
    params.since = opts.since
  }
  if (opts?.until) {
    conditions.push('a.published_at <= @until')
    params.until = opts.until
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

  const totals = getNamed<{ total: number; read: number; unread: number }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN a.seen_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN a.seen_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM active_articles a
    ${where}
  `, params)

  const byFeed = allNamed<{ feed_id: number; feed_name: string; total: number; read: number; unread: number }>(`
    SELECT
      a.feed_id,
      f.name AS feed_name,
      COUNT(*) AS total,
      SUM(CASE WHEN a.seen_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN a.seen_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    GROUP BY a.feed_id
    ORDER BY total DESC
  `, params)

  return { ...totals, by_feed: byFeed }
}

// --- Retention policy ---

export function getRetentionStats(readDays: number, unreadDays: number): { readEligible: number; unreadEligible: number } {
  const readRow = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NOT NULL
      AND seen_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).get(readDays) as { cnt: number }

  const unreadRow = getDb().prepare(`
    SELECT COUNT(*) AS cnt FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NULL
      AND fetched_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).get(unreadDays) as { cnt: number }

  return { readEligible: readRow.cnt, unreadEligible: unreadRow.cnt }
}

export function purgeExpiredArticles(readDays: number, unreadDays: number): { purged: number } {
  const db = getDb()

  // Collect IDs to purge — use seen_at for read status (consistent with UI unread indicator)
  const readIds = db.prepare(`
    SELECT id FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NOT NULL
      AND seen_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).all(readDays) as { id: number }[]

  const unreadIds = db.prepare(`
    SELECT id FROM articles
    WHERE purged_at IS NULL
      AND feed_id NOT IN (SELECT id FROM feeds WHERE type = 'clip')
      AND seen_at IS NULL
      AND fetched_at < datetime('now', '-' || ? || ' days')
      AND bookmarked_at IS NULL
      AND liked_at IS NULL
  `).all(unreadDays) as { id: number }[]

  const allIds = [...readIds, ...unreadIds].map(r => r.id)
  if (allIds.length === 0) return { purged: 0 }

  // Process in batches to avoid overly large SQL
  const BATCH = 500
  let purged = 0

  for (let i = 0; i < allIds.length; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(',')

    // Clean up archived images before the transaction (external I/O)
    const articlesWithImages = db.prepare(
      `SELECT id FROM articles WHERE id IN (${placeholders}) AND images_archived_at IS NOT NULL`,
    ).all(...batch) as { id: number }[]

    for (const { id } of articlesWithImages) {
      try {
        deleteArticleImages(id)
      } catch (err) {
        log.warn(`Failed to delete images for article ${id}:`, err)
      }
    }

    // Soft delete + search index removal in a transaction to keep them consistent
    const result = db.transaction(() => {
      const res = db.prepare(`
        UPDATE articles
        SET full_text = NULL,
            full_text_translated = NULL,
            excerpt = NULL,
            summary = NULL,
            og_image = NULL,
            images_archived_at = NULL,
            last_error = NULL,
            retry_count = 0,
            purged_at = datetime('now')
        WHERE id IN (${placeholders})
      `).run(...batch)

      deleteArticlesFromSearch(batch)

      return res
    })()

    purged += result.changes
  }

  return { purged }
}
