import {
  searchArticles,
  getArticleById,
  getArticlesByIds,
  getFeeds,
  getCategories,
  getReadingStats,
  markArticleSeen,
  markArticleLiked,
  markArticleBookmarked,
  updateArticleContent,
  updateScore,
  getDb,
  type ArticleListItem,
  type ArticleDetail,
} from '../db.js'
import { buildMeiliFilter, meiliSearch } from '../search/client.js'
import { isSearchReady } from '../search/sync.js'
import { summarizeArticle, translateArticle } from '../fetcher.js'
import { getSetting } from '../db/settings.js'
import { DEFAULT_LANGUAGE } from '../../shared/lang.js'
import { articleUrlToPath } from '../../shared/url.js'
import type { ChatScope } from '../../shared/types.js'
import { applyScopeToArticleSearch, applyScopeToReadingStats, assertArticleInScope } from './scope.js'

/** Convert a UTC datetime string from SQLite to a local-time ISO-like string */
function toLocalTime(utc: string | null, timeZone?: string): string | null {
  if (!utc) return null
  const d = new Date(utc.endsWith('Z') ? utc : utc + 'Z')
  return d.toLocaleString('sv-SE', { timeZone: timeZone || 'UTC' }).replace(' ', 'T')
}

/** Clamp a user-provided limit to a safe range. */
function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(Math.floor(value), max))
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (!Number.isInteger(value) || Number(value) <= 0) return undefined
  return Number(value)
}

function normalizeOptInBoolean(value: unknown): true | undefined {
  return value === true ? true : undefined
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizeIsoLikeDateString(value: unknown): string | undefined {
  const normalized = normalizeNonEmptyString(value)
  if (!normalized) return undefined
  return Number.isNaN(Date.parse(normalized)) ? undefined : normalized
}

function normalizeSearchArticlesInput(input: Record<string, unknown>): Record<string, unknown> {
  const article_kind = input.article_kind
  const sort = input.sort

  return {
    ...(normalizeNonEmptyString(input.query) ? { query: normalizeNonEmptyString(input.query) } : {}),
    ...(normalizePositiveInteger(input.feed_id) ? { feed_id: normalizePositiveInteger(input.feed_id) } : {}),
    ...(normalizePositiveInteger(input.category_id) ? { category_id: normalizePositiveInteger(input.category_id) } : {}),
    ...(normalizeOptInBoolean(input.unread) ? { unread: true } : {}),
    ...(normalizeOptInBoolean(input.read) ? { read: true } : {}),
    ...(normalizeOptInBoolean(input.liked) ? { liked: true } : {}),
    ...(normalizeOptInBoolean(input.bookmarked) ? { bookmarked: true } : {}),
    ...(article_kind === 'original' || article_kind === 'repost' || article_kind === 'quote' ? { article_kind } : {}),
    ...(normalizeIsoLikeDateString(input.since) ? { since: normalizeIsoLikeDateString(input.since) } : {}),
    ...(normalizeIsoLikeDateString(input.until) ? { until: normalizeIsoLikeDateString(input.until) } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    ...(sort === 'published_at' || sort === 'score' ? { sort } : {}),
    ...(Array.isArray(input.__scope_article_ids) ? { __scope_article_ids: input.__scope_article_ids } : {}),
  }
}

// --- Neutral tool definition (MCP / Anthropic compatible) ---

export interface ToolContext {
  timeZone?: string
  scope?: ChatScope
  userLanguage?: string
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  execute: (input: Record<string, unknown>, context?: ToolContext) => Promise<string>
}

// --- Tool implementations ---

const searchArticlesTool: ToolDef = {
  name: 'search_articles',
  description: 'Search articles. Supports Meilisearch full-text keyword search, feed/category filtering, unread/liked/bookmarked filters, and date range. The score field in results is an engagement score (liked+10, bookmarked+5, translated+3, read+2 with time decay) — higher values indicate more important articles. Use this for recommendations and rankings. The url field is an app-internal path (/example.com/...) — use it as-is for links.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keyword search query (Meilisearch full-text search)' },
      feed_id: { type: 'number', description: 'Filter by feed ID' },
      category_id: { type: 'number', description: 'Filter by category ID' },
      unread: { type: 'boolean', description: 'Show unread articles only' },
      read: { type: 'boolean', description: 'Show read articles only' },
      liked: { type: 'boolean', description: 'Show liked articles only' },
      bookmarked: { type: 'boolean', description: 'Show bookmarked articles only' },
      article_kind: { type: 'string', enum: ['original', 'repost', 'quote'], description: 'Filter by article kind' },
      since: { type: 'string', description: 'Start datetime (ISO 8601). Compared against published_at' },
      until: { type: 'string', description: 'End datetime (ISO 8601). Compared against published_at' },
      limit: { type: 'number', description: 'Maximum number of results (default: 20, max: 100)' },
      sort: { type: 'string', enum: ['published_at', 'score'], description: 'Sort order (default: relevance for keyword search, published_at desc otherwise)' },
    },
  },
  execute: async (input, context) => {
    const normalized = normalizeSearchArticlesInput(input)
    const query = normalized.query as string | undefined
    const feed_id = normalized.feed_id as number | undefined
    const category_id = normalized.category_id as number | undefined
    const unread = normalized.unread as true | undefined
    const read = normalized.read as true | undefined
    const liked = normalized.liked as true | undefined
    const bookmarked = normalized.bookmarked as true | undefined
    const since = normalized.since as string | undefined
    const until = normalized.until as string | undefined
    const limit = clampLimit(normalized.limit as number | undefined, 20, 100)
    const sort = normalized.sort as 'published_at' | 'score' | undefined
    const scopeArticleIds = normalized.__scope_article_ids as number[] | undefined
    const normalizedArticleKind = normalized.article_kind as 'original' | 'repost' | 'quote' | undefined
    const scopedSourceArticleKind = context?.scope?.type === 'list' ? context.scope.source_filters?.article_kind : undefined
    const article_kind = scopeArticleIds && normalizedArticleKind === 'original' && scopedSourceArticleKind !== 'original'
      ? undefined
      : normalizedArticleKind

    let results: ArticleListItem[]

    const useMeili = !!query && isSearchReady() && !scopeArticleIds && read === undefined && article_kind === undefined

    if (useMeili) {
      // Meilisearch path
      const filter = buildMeiliFilter({ feed_id, category_id, since, until, unread, liked, bookmarked })
      const meiliSort = sort ? [`${sort}:desc`] : undefined

      const { hits } = await meiliSearch(query, { limit, filter, sort: meiliSort })
      const ids = hits.map((h) => h.id)
      results = getArticlesByIds(ids)
    } else {
      // No query or search not ready: SQLite fallback
      results = searchArticles({
        query,
        feed_id,
        category_id,
        unread,
        read,
        liked,
        bookmarked,
        article_kind,
        article_ids: scopeArticleIds,
        since,
        until,
        limit,
        sort,
      })
    }

    return JSON.stringify(results.map((a: ArticleListItem) => ({
      id: a.id,
      feed_name: a.feed_name,
      title: a.title,
      url: articleUrlToPath(a.url),
      published_at: a.published_at,
      summary: a.summary?.slice(0, 200) ?? null,
      seen_at: a.seen_at,
      score: a.score,
    })))
  },
}

const getArticleTool: ToolDef = {
  name: 'get_article',
  description: 'Get article details including full text (full_text), translation (full_text_translated), and summary.',
  inputSchema: {
    type: 'object',
    properties: {
      article_id: { type: 'number', description: 'Article ID' },
    },
    required: ['article_id'],
  },
  execute: async (input) => {
    const article = getArticleById(input.article_id as number)
    if (!article) return JSON.stringify({ error: 'Article not found' })
    const truncate = (text: string | null | undefined, limit: number) =>
      text && text.length > limit ? text.slice(0, limit) + '\n… (truncated)' : text ?? null
    return JSON.stringify({
      id: article.id,
      feed_name: article.feed_name,
      title: article.title,
      url: articleUrlToPath(article.url),
      published_at: article.published_at,
      lang: article.lang,
      summary: article.summary,
      full_text: truncate(article.full_text, 15000),
      full_text_translated: truncate((article as ArticleDetail).full_text_translated, 15000),
      seen_at: article.seen_at,
    })
  },
}

const getFeedsTool: ToolDef = {
  name: 'get_feeds',
  description: 'Get list of subscribed feeds, including article count and unread count per feed.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const feeds = getFeeds()
    return JSON.stringify(feeds.map(f => ({
      id: f.id,
      name: f.name,
      url: f.url,
      category_name: f.category_name,
      article_count: f.article_count,
      unread_count: f.unread_count,
    })))
  },
}

const getCategoriesTool: ToolDef = {
  name: 'get_categories',
  description: 'Get list of categories.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const categories = getCategories()
    return JSON.stringify(categories)
  },
}

const getReadingStatsTool: ToolDef = {
  name: 'get_reading_stats',
  description: 'Get reading statistics: total and per-feed article count, read count, and unread count.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', description: 'Start datetime (ISO 8601). Compared against published_at' },
      until: { type: 'string', description: 'End datetime (ISO 8601). Compared against published_at' },
    },
  },
  execute: async (input) => {
    const stats = getReadingStats({
      since: input.since as string | undefined,
      until: input.until as string | undefined,
      article_ids: input.__scope_article_ids as number[] | undefined,
    })
    return JSON.stringify(stats)
  },
}

const markAsReadTool: ToolDef = {
  name: 'mark_as_read',
  description: 'Mark an article as read.',
  inputSchema: {
    type: 'object',
    properties: {
      article_id: { type: 'number', description: 'Article ID' },
    },
    required: ['article_id'],
  },
  execute: async (input) => {
    const result = markArticleSeen(input.article_id as number, true)
    if (!result) return JSON.stringify({ error: 'Article not found' })
    return JSON.stringify({ success: true })
  },
}

const toggleLikeTool: ToolDef = {
  name: 'toggle_like',
  description: 'Toggle the like status of an article. Removes like if already liked, adds like if not.',
  inputSchema: {
    type: 'object',
    properties: {
      article_id: { type: 'number', description: 'Article ID' },
    },
    required: ['article_id'],
  },
  execute: async (input) => {
    const article = getArticleById(input.article_id as number)
    if (!article) return JSON.stringify({ error: 'Article not found' })
    const currentlyLiked = !!article.liked_at
    const result = markArticleLiked(article.id, !currentlyLiked)
    return JSON.stringify({ liked: !currentlyLiked, liked_at: result?.liked_at ?? null })
  },
}

const toggleBookmarkTool: ToolDef = {
  name: 'toggle_bookmark',
  description: 'Toggle the bookmark status of an article. Removes bookmark if already bookmarked, adds bookmark if not.',
  inputSchema: {
    type: 'object',
    properties: {
      article_id: { type: 'number', description: 'Article ID' },
    },
    required: ['article_id'],
  },
  execute: async (input) => {
    const article = getArticleById(input.article_id as number)
    if (!article) return JSON.stringify({ error: 'Article not found' })
    const currentlyBookmarked = !!article.bookmarked_at
    const result = markArticleBookmarked(article.id, !currentlyBookmarked)
    return JSON.stringify({ bookmarked: !currentlyBookmarked, bookmarked_at: result?.bookmarked_at ?? null })
  },
}

const summarizeArticleTool: ToolDef = {
  name: 'summarize_article',
  description: 'Summarize an article in the user\'s preferred language. Returns cached summary if already summarized.',
  inputSchema: {
    type: 'object',
    properties: {
      article_id: { type: 'number', description: 'Article ID' },
    },
    required: ['article_id'],
  },
  execute: async (input, context) => {
    const article = getArticleById(input.article_id as number)
    if (!article) return JSON.stringify({ error: 'Article not found' })
    if (article.summary) return JSON.stringify({ summary: article.summary, cached: true })
    if (!article.full_text) return JSON.stringify({ error: 'No full text available' })

    const { summary } = await summarizeArticle(article.full_text, context?.userLanguage)
    updateArticleContent(article.id, { summary })
    return JSON.stringify({ summary })
  },
}

const translateArticleTool: ToolDef = {
  name: 'translate_article',
  description: 'Translate an article into the user\'s preferred language. Returns cached translation if already translated.',
  inputSchema: {
    type: 'object',
    properties: {
      article_id: { type: 'number', description: 'Article ID' },
    },
    required: ['article_id'],
  },
  execute: async (input, context) => {
    const userLang = context?.userLanguage || getSetting('general.language') || DEFAULT_LANGUAGE
    const article = getArticleById(input.article_id as number) as ArticleDetail | undefined
    if (!article) return JSON.stringify({ error: 'Article not found' })
    if (article.full_text_translated && article.translated_lang === userLang) return JSON.stringify({ full_text_translated: article.full_text_translated, cached: true })
    if (!article.full_text) return JSON.stringify({ error: 'No full text available' })
    if (article.lang === userLang) return JSON.stringify({ error: `Article is already in ${userLang}` })

    const { fullTextTranslated } = await translateArticle(article.full_text)
    updateArticleContent(article.id, { full_text_translated: fullTextTranslated, translated_lang: userLang })
    updateScore(article.id)
    return JSON.stringify({ full_text_translated: fullTextTranslated })
  },
}

const getUserPreferencesTool: ToolDef = {
  name: 'get_user_preferences',
  description: 'Get user reading preferences and interests. Includes top feeds, top categories, recent likes/bookmarks. Call this before making recommendations to understand user preferences.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const db = getDb()

    const feedStats = db.prepare(`
      SELECT f.name,
             COUNT(CASE WHEN a.liked_at IS NOT NULL THEN 1 END) AS like_count,
             COUNT(CASE WHEN a.bookmarked_at IS NOT NULL THEN 1 END) AS bookmark_count,
             COUNT(CASE WHEN a.read_at IS NOT NULL THEN 1 END) AS read_count,
             COUNT(*) AS article_count,
             ROUND(COUNT(CASE WHEN a.read_at IS NOT NULL THEN 1 END) * 1.0 / COUNT(*), 2) AS read_rate,
             COUNT(CASE WHEN a.published_at > datetime('now', '-30 days') AND a.read_at IS NULL THEN 1 END) AS recent_unread_count
      FROM active_articles a
      JOIN feeds f ON a.feed_id = f.id
      WHERE f.type != 'clip'
      GROUP BY f.id
    `).all() as Array<{
      name: string
      like_count: number
      bookmark_count: number
      read_count: number
      article_count: number
      read_rate: number
      recent_unread_count: number
    }>
    const topFeeds = feedStats
      .filter(feed => feed.read_count > 0 || feed.like_count > 0 || feed.bookmark_count > 0)
      .sort((a, b) => (b.like_count * 10 + b.bookmark_count * 5 + b.read_count * 2) - (a.like_count * 10 + a.bookmark_count * 5 + a.read_count * 2))
      .slice(0, 10)
      .map(({ name, like_count, bookmark_count, read_count, article_count, read_rate }) => ({
        name,
        like_count,
        bookmark_count,
        read_count,
        article_count,
        read_rate,
      }))

    const categoryStats = db.prepare(`
      SELECT c.name,
             COUNT(CASE WHEN a.read_at IS NOT NULL THEN 1 END) AS read_count,
             COUNT(CASE WHEN a.liked_at IS NOT NULL THEN 1 END) AS like_count,
             COUNT(CASE WHEN a.published_at > datetime('now', '-30 days') THEN 1 END) AS recent_total,
             COUNT(CASE WHEN a.published_at > datetime('now', '-30 days') AND a.read_at IS NOT NULL THEN 1 END) AS recent_read_count
      FROM active_articles a
      JOIN feeds f ON a.feed_id = f.id
      JOIN categories c ON f.category_id = c.id
      WHERE f.type != 'clip'
        AND (
          a.read_at IS NOT NULL
          OR a.liked_at IS NOT NULL
          OR a.published_at > datetime('now', '-30 days')
        )
      GROUP BY c.id
    `).all() as Array<{
      name: string
      read_count: number
      like_count: number
      recent_total: number
      recent_read_count: number
    }>
    const topCategories = categoryStats
      .filter(category => category.read_count > 0 || category.like_count > 0)
      .sort((a, b) => (b.like_count * 5 + b.read_count) - (a.like_count * 5 + a.read_count))
      .slice(0, 5)
      .map(({ name, read_count, like_count }) => ({ name, read_count, like_count }))

    const recentCollectionRows = db.prepare(`
      SELECT 'liked' AS collection_type, title, feed_name, published_at, summary
      FROM (
        SELECT a.title, f.name AS feed_name, a.published_at, a.summary, a.liked_at AS collection_at
        FROM active_articles a
        JOIN feeds f ON a.feed_id = f.id
        WHERE a.liked_at IS NOT NULL
        ORDER BY a.liked_at DESC
        LIMIT 20
      )
      UNION ALL
      SELECT 'bookmarked' AS collection_type, title, feed_name, published_at, NULL AS summary
      FROM (
        SELECT a.title, f.name AS feed_name, a.published_at, a.bookmarked_at AS collection_at
        FROM active_articles a
        JOIN feeds f ON a.feed_id = f.id
        WHERE a.bookmarked_at IS NOT NULL
        ORDER BY a.bookmarked_at DESC
        LIMIT 10
      )
    `).all() as Array<{
      collection_type: 'liked' | 'bookmarked'
      title: string
      feed_name: string
      published_at: string
      summary: string | null
    }>
    const recentLikes = recentCollectionRows.filter(row => row.collection_type === 'liked')
    const recentBookmarks = recentCollectionRows
      .filter(row => row.collection_type === 'bookmarked')
      .map(({ title, feed_name, published_at }) => ({ title, feed_name, published_at }))

    const categoryReadRates = categoryStats
      .filter(category => category.recent_total > 0)
      .map(category => ({
        name: category.name,
        total: category.recent_total,
        read_count: category.recent_read_count,
        read_rate: Math.round((category.recent_read_count / category.recent_total) * 100) / 100,
      }))
      .sort((a, b) => b.read_rate - a.read_rate)

    const ignoredFeeds = feedStats
      .filter(feed => feed.recent_unread_count > 10)
      .sort((a, b) => b.recent_unread_count - a.recent_unread_count)
      .slice(0, 5)
      .map(({ name, recent_unread_count }) => ({ name, unread_articles: recent_unread_count }))

    return JSON.stringify({
      top_feeds: topFeeds,
      top_categories: topCategories,
      category_read_rates: categoryReadRates,
      recent_likes: recentLikes.map(a => ({
        title: a.title,
        feed_name: a.feed_name,
        published_at: a.published_at,
        summary: a.summary?.slice(0, 200) ?? null,
      })),
      recent_bookmarks: recentBookmarks,
      ignored_feeds: ignoredFeeds,
    })
  },
}

const getRecentActivityTool: ToolDef = {
  name: 'get_recent_activity',
  description: 'Get user\'s recent activity (read, liked, bookmarked) in chronological order. Use for questions like "articles I read recently" or "my recent likes". The url field is an app-internal path.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['read', 'liked', 'bookmarked', 'all'],
        description: 'Activity type filter (default: all)',
      },
      limit: { type: 'number', description: 'Maximum number of results (default: 15, max: 50)' },
    },
  },
  execute: async (input, context) => {
    const type = (input.type as string) ?? 'all'
    const limit = clampLimit(input.limit as number | undefined, 15, 50)
    const db = getDb()

    // Build UNION query based on type filter
    const parts: string[] = []
    if (type === 'all' || type === 'read') {
      parts.push(`
        SELECT a.id, a.title, f.name AS feed_name, a.url, a.published_at,
               a.summary, a.seen_at AS activity_at, 'read' AS activity_type
        FROM active_articles a JOIN feeds f ON a.feed_id = f.id
        WHERE a.seen_at IS NOT NULL AND f.type != 'clip'
      `)
    }
    if (type === 'all' || type === 'liked') {
      parts.push(`
        SELECT a.id, a.title, f.name AS feed_name, a.url, a.published_at,
               a.summary, a.liked_at AS activity_at, 'liked' AS activity_type
        FROM active_articles a JOIN feeds f ON a.feed_id = f.id
        WHERE a.liked_at IS NOT NULL AND f.type != 'clip'
      `)
    }
    if (type === 'all' || type === 'bookmarked') {
      parts.push(`
        SELECT a.id, a.title, f.name AS feed_name, a.url, a.published_at,
               a.summary, a.bookmarked_at AS activity_at, 'bookmarked' AS activity_type
        FROM active_articles a JOIN feeds f ON a.feed_id = f.id
        WHERE a.bookmarked_at IS NOT NULL AND f.type != 'clip'
      `)
    }

    if (parts.length === 0) {
      return JSON.stringify([])
    }

    const sql = `${parts.join(' UNION ALL ')} ORDER BY activity_at DESC LIMIT ?`
    const rows = db.prepare(sql).all(limit) as {
      id: number; title: string; feed_name: string; url: string;
      published_at: string; summary: string | null;
      activity_at: string; activity_type: string
    }[]

    return JSON.stringify(rows.map(r => ({
      id: r.id,
      title: r.title,
      feed_name: r.feed_name,
      url: articleUrlToPath(r.url),
      published_at: toLocalTime(r.published_at, context?.timeZone),
      summary: r.summary?.slice(0, 200) ?? null,
      activity_at: toLocalTime(r.activity_at, context?.timeZone),
      activity_type: r.activity_type,
    })))
  },
}

const getSimilarArticlesTool: ToolDef = {
  name: 'get_similar_articles',
  description: 'Find similar articles using Meilisearch. Uses the article\'s title and summary as the search query.',
  inputSchema: {
    type: 'object',
    properties: {
      article_id: { type: 'number', description: 'Article ID to find similar articles for' },
      limit: { type: 'number', description: 'Maximum number of results (default: 5, max: 20)' },
    },
    required: ['article_id'],
  },
  execute: async (input) => {
    const articleId = input.article_id as number
    const limit = clampLimit(input.limit as number | undefined, 5, 20)

    if (!isSearchReady()) {
      return JSON.stringify({ error: 'Search index is building' })
    }

    const article = getArticleById(articleId)
    if (!article) {
      return JSON.stringify({ error: 'Article not found' })
    }

    // Use title + summary as query for similarity search
    const queryText = [article.title, article.summary].filter(Boolean).join(' ')
    if (!queryText) {
      return JSON.stringify([])
    }

    try {
      const { hits } = await meiliSearch(queryText, { limit: limit + 1 })
      // Exclude the source article itself
      const ids = hits.map((h) => h.id).filter((id) => id !== articleId).slice(0, limit)
      const results = getArticlesByIds(ids)
      return JSON.stringify(results.map((a: ArticleListItem) => ({
        id: a.id,
        feed_name: a.feed_name,
        title: a.title,
        url: articleUrlToPath(a.url),
        published_at: a.published_at,
        summary: a.summary?.slice(0, 200) ?? null,
        score: a.score,
      })))
    } catch {
      return JSON.stringify({ error: 'Similar article search failed' })
    }
  },
}

// --- Exported tools array ---

export const TOOLS: ToolDef[] = [
  searchArticlesTool,
  getArticleTool,
  getSimilarArticlesTool,
  getUserPreferencesTool,
  getRecentActivityTool,
  getFeedsTool,
  getCategoriesTool,
  getReadingStatsTool,
  markAsReadTool,
  toggleLikeTool,
  toggleBookmarkTool,
  summarizeArticleTool,
  translateArticleTool,
]

// --- Anthropic API conversion ---

export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }> {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))
}

// --- OpenAI API conversion ---

export function toOpenAITools() {
  return TOOLS.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }))
}

// --- Gemini API conversion ---

export function toGeminiTools() {
  return [{ functionDeclarations: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.inputSchema,
  })) }]
}

// --- Dispatch ---

const toolMap = new Map(TOOLS.map(t => [t.name, t]))
const ARTICLE_SCOPED_TOOL_NAMES = new Set([
  'get_article',
  'mark_as_read',
  'toggle_like',
  'toggle_bookmark',
  'summarize_article',
  'translate_article',
])

export async function executeTool(name: string, input: Record<string, unknown>, context?: ToolContext): Promise<string> {
  const tool = toolMap.get(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  if (ARTICLE_SCOPED_TOOL_NAMES.has(name)) {
    assertArticleInScope(input.article_id as number, context?.scope)
  }
  const effectiveInput = name === 'search_articles'
    ? applyScopeToArticleSearch(input, context?.scope)
    : name === 'get_reading_stats'
      ? applyScopeToReadingStats(input, context?.scope)
      : input
  return tool.execute(effectiveInput, context)
}
