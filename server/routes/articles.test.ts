import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, createCategory, getDb, insertArticle, getArticleById, markArticleSeen, upsertSetting } from '../db.js'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockStreamSummarize, mockStreamTranslate, mockCreateTextTranslator, mockTranslateText } = vi.hoisted(() => ({
  mockStreamSummarize: vi.fn(),
  mockStreamTranslate: vi.fn(),
  mockCreateTextTranslator: vi.fn(),
  mockTranslateText: vi.fn(),
}))

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: vi.fn(),
    discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
    summarizeArticle: vi.fn().mockResolvedValue({ summary: 'summary text', inputTokens: 10, outputTokens: 5, billingMode: 'standard', model: 'haiku' }),
    streamSummarizeArticle: (...args: unknown[]) => mockStreamSummarize(...args),
    translateArticle: vi.fn().mockResolvedValue({ fullTextTranslated: '翻訳テキスト', inputTokens: 10, outputTokens: 5, billingMode: 'standard', model: 'sonnet' }),
    streamTranslateArticle: (...args: unknown[]) => mockStreamTranslate(...args),
    createTextTranslator: (...args: unknown[]) => mockCreateTextTranslator(...args),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
  }
})

vi.mock('../anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

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

beforeEach(async () => {
  setupTestDb()
  const { _clearTitleTranslateCacheForTests } = await import('./articles.js')
  _clearTitleTranslateCacheForTests()
  app = await buildApp()
  mockStreamSummarize.mockReset()
  mockStreamTranslate.mockReset()
  mockCreateTextTranslator.mockReset()
  mockTranslateText.mockReset()
  mockTranslateText.mockImplementation(async (text: string) => ({ fullTextTranslated: `${text} (translated)`, inputTokens: 1, outputTokens: 1, billingMode: 'standard', model: 'sonnet' }))
  mockCreateTextTranslator.mockImplementation(() => (text: string) => mockTranslateText(text))
})

// ---------------------------------------------------------------------------
// Streaming summarize
// ---------------------------------------------------------------------------

describe('POST /api/articles/:id/summarize?stream=1', () => {
  it('returns SSE stream with delta and done events', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Long article content here' })

    mockStreamSummarize.mockImplementation(async (_text: string, onDelta: (d: string) => void) => {
      onDelta('sum')
      onDelta('mary')
      return { summary: 'summary', inputTokens: 10, outputTokens: 5, billingMode: 'standard', model: 'haiku' }
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/summarize?stream=1`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')

    const events = res.body
      .split('\n')
      .filter((l: string) => l.startsWith('data: '))
      .map((l: string) => JSON.parse(l.slice(6)))

    const deltas = events.filter((e: any) => e.type === 'delta')
    expect(deltas).toHaveLength(2)
    expect(deltas[0].text).toBe('sum')
    expect(deltas[1].text).toBe('mary')

    const done = events.find((e: any) => e.type === 'done')
    expect(done).toBeDefined()
    expect(done.usage.input_tokens).toBe(10)
  })

  it('returns cached summary even when stream=1', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'text', summary: 'Cached' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/summarize?stream=1`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().text).toBe('Cached')
    expect(res.json().cached).toBe(true)
  })

  it('handles streaming error after headers sent', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Long content' })

    mockStreamSummarize.mockRejectedValue(new Error('API timeout'))

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/summarize?stream=1`,
      headers: json,
      payload: {},
    })

    // The SSE stream should contain an error event
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')

    const events = res.body
      .split('\n')
      .filter((l: string) => l.startsWith('data: '))
      .map((l: string) => JSON.parse(l.slice(6)))

    const errorEvent = events.find((e: any) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent.error).toBe('SUMMARIZATION_FAILED')
  })
})

// ---------------------------------------------------------------------------
// Translate edge cases
// ---------------------------------------------------------------------------

describe('POST /api/articles/:id/translate', () => {
  it('returns cached translation', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'English text', full_text_translated: '日本語テキスト', translated_lang: 'en' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/translate`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().text).toBe('日本語テキスト')
    expect(res.json().cached).toBe(true)
  })

  it('does not return cached translation when translated_lang differs from user language', async () => {
    const feed = seedFeed()
    // translated_lang='ja' but user language defaults to 'en' → stale, should re-translate
    const artId = seedArticle(feed.id, { full_text: 'French text', lang: 'fr', full_text_translated: '古い日本語訳', translated_lang: 'ja' })

    mockStreamTranslate.mockReset()

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/translate`,
      headers: json,
      payload: {},
    })

    // Should NOT return cached — should invoke translation (non-stream returns new text)
    expect(res.statusCode).toBe(200)
    expect(res.json().cached).toBeUndefined()
  })

  it('does not return cached translation when translated_lang is null', async () => {
    const feed = seedFeed()
    // translated_lang=null (legacy data) → stale
    const artId = seedArticle(feed.id, { full_text: 'French text', lang: 'fr', full_text_translated: '古い翻訳' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/translate`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().cached).toBeUndefined()
  })

  it('returns 400 when article is already in user language', async () => {
    const feed = seedFeed()
    // Default user language is 'en', so an English article should be rejected
    const artId = seedArticle(feed.id, { full_text: 'English article', lang: 'en' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/translate`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/already in en/)
  })

  it('returns 400 when no full_text', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: null })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/translate`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/full text/i)
  })

  it('returns 404 for non-existent article', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/9999/translate',
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Streaming translate
// ---------------------------------------------------------------------------

describe('POST /api/articles/:id/translate?stream=1', () => {
  it('returns SSE stream with deltas', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Contenu en français', lang: 'fr' })

    mockStreamTranslate.mockImplementation(async (_text: string, onDelta: (d: string) => void) => {
      onDelta('翻訳')
      onDelta('テキスト')
      return { fullTextTranslated: '翻訳テキスト', inputTokens: 20, outputTokens: 15, billingMode: 'standard', model: 'sonnet' }
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/translate?stream=1`,
      headers: json,
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')

    const events = res.body
      .split('\n')
      .filter((l: string) => l.startsWith('data: '))
      .map((l: string) => JSON.parse(l.slice(6)))

    const deltas = events.filter((e: any) => e.type === 'delta')
    expect(deltas).toHaveLength(2)

    const done = events.find((e: any) => e.type === 'done')
    expect(done).toBeDefined()
    expect(done.usage.input_tokens).toBe(20)
  })

  it('handles streaming translate error', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id, { full_text: 'Contenu', lang: 'fr' })

    mockStreamTranslate.mockRejectedValue(new Error('API error'))

    const res = await app.inject({
      method: 'POST',
      url: `/api/articles/${artId}/translate?stream=1`,
      headers: json,
      payload: {},
    })

    const events = res.body
      .split('\n')
      .filter((l: string) => l.startsWith('data: '))
      .map((l: string) => JSON.parse(l.slice(6)))

    const errorEvent = events.find((e: any) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect(errorEvent.error).toBe('TRANSLATION_FAILED')
  })
})

describe('POST /api/articles/translate-titles', () => {
  it('resolves target language with a batched settings query', async () => {
    upsertSetting('general.language', 'zh')
    const feed = seedFeed()
    const id = seedArticle(feed.id, { title: 'Bonjour le monde', lang: 'fr' })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/translate-titles',
      headers: json,
      payload: { ids: [id] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().target_lang).toBe('zh')
    expect(preparedSql.some(sql => sql.includes('FROM settings') && sql.includes('key IN'))).toBe(true)
    expect(preparedSql.filter(sql => sql.includes('SELECT value FROM settings WHERE key = ?'))).toHaveLength(0)
  })

  it('translates non-target-language titles and keeps target-language titles unchanged', async () => {
    const feed = seedFeed()
    const frId = seedArticle(feed.id, { title: 'Bonjour le monde', lang: 'fr' })
    const enId = seedArticle(feed.id, { title: 'Already English', lang: 'en' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/translate-titles',
      headers: json,
      payload: { ids: [frId, enId] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().translated_titles[frId]).toBe('Bonjour le monde (translated)')
    expect(res.json().translated_titles[enId]).toBe('Already English')
    expect(res.json().target_lang).toBe('en')
  })

  it('translates titles with bounded concurrency', async () => {
    const feed = seedFeed()
    const ids = Array.from({ length: 6 }, (_, index) => (
      seedArticle(feed.id, { title: `Bonjour ${index}`, lang: 'fr' })
    ))
    let inFlight = 0
    let maxInFlight = 0
    mockTranslateText.mockImplementation(async (text: string) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 10))
      inFlight -= 1
      return { fullTextTranslated: `${text} (translated)`, inputTokens: 1, outputTokens: 1, billingMode: 'standard', model: 'sonnet' }
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/articles/translate-titles',
      headers: json,
      payload: { ids },
    })

    expect(res.statusCode).toBe(200)
    expect(mockCreateTextTranslator).toHaveBeenCalledTimes(1)
    expect(mockCreateTextTranslator).toHaveBeenCalledWith('en', null)
    expect(mockTranslateText).toHaveBeenCalledTimes(6)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })

  it('reuses cached title translations across duplicate titles and requests', async () => {
    const feed = seedFeed()
    const ids = Array.from({ length: 3 }, (_, index) => (
      seedArticle(feed.id, { title: 'Bonjour cache', lang: 'fr', url: `https://example.com/cache-${index}` })
    ))

    const first = await app.inject({
      method: 'POST',
      url: '/api/articles/translate-titles',
      headers: json,
      payload: { ids },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/articles/translate-titles',
      headers: json,
      payload: { ids },
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(mockTranslateText).toHaveBeenCalledTimes(1)
    for (const id of ids) {
      expect(first.json().translated_titles[id]).toBe('Bonjour cache (translated)')
      expect(second.json().translated_titles[id]).toBe('Bonjour cache (translated)')
    }
  })

  it('does not cache failed title translations', async () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { title: 'Bonjour retry', lang: 'fr' })
    mockTranslateText
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockResolvedValueOnce({ fullTextTranslated: 'Bonjour retry translated', inputTokens: 1, outputTokens: 1, billingMode: 'standard', model: 'sonnet' })

    const first = await app.inject({
      method: 'POST',
      url: '/api/articles/translate-titles',
      headers: json,
      payload: { ids: [id] },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/articles/translate-titles',
      headers: json,
      payload: { ids: [id] },
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.json().translated_titles[id]).toBe('Bonjour retry')
    expect(second.json().translated_titles[id]).toBe('Bonjour retry translated')
    expect(mockTranslateText).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Limit/offset boundary values
// ---------------------------------------------------------------------------

describe('GET /api/articles boundary values', () => {
  it('clamps limit to 1-100 range', async () => {
    const feed = seedFeed()
    for (let i = 0; i < 3; i++) seedArticle(feed.id)

    // limit=0 → NaN || 20 → clamped to 20 via Math.min(Math.max(NaN||20,1),100)
    const res1 = await app.inject({ method: 'GET', url: '/api/articles?limit=0' })
    expect(res1.statusCode).toBe(200)
    // 0 is falsy so Number(0)||20 = 20, returns all 3
    expect(res1.json().articles.length).toBe(3)

    // limit=999 → clamped to 100
    const res2 = await app.inject({ method: 'GET', url: '/api/articles?limit=999' })
    expect(res2.statusCode).toBe(200)

    // limit=2 → returns exactly 2
    const res3 = await app.inject({ method: 'GET', url: '/api/articles?limit=2' })
    expect(res3.json().articles.length).toBe(2)
    expect(res3.json().has_more).toBe(true)
  })

  it('clamps negative offset to 0', async () => {
    const feed = seedFeed()
    seedArticle(feed.id)

    const res = await app.inject({ method: 'GET', url: '/api/articles?offset=-10' })
    expect(res.statusCode).toBe(200)
    expect(res.json().articles).toHaveLength(1)
  })

  it('uses offset pages to probe has_more without requiring exact total', async () => {
    const feed = seedFeed()
    for (let i = 0; i < 25; i++) {
      seedArticle(feed.id, {
        url: `https://example.com/offset-page-${i}`,
        published_at: new Date(Date.now() - i * 60_000).toISOString(),
      })
    }

    const res = await app.inject({ method: 'GET', url: '/api/articles?limit=10&offset=10' })

    expect(res.statusCode).toBe(200)
    expect(res.json().articles).toHaveLength(10)
    expect(res.json().has_more).toBe(true)
    expect(res.json().total).toBe(21)
  })

  it('handles non-numeric limit/offset gracefully', async () => {
    const feed = seedFeed()
    seedArticle(feed.id)

    const res = await app.inject({ method: 'GET', url: '/api/articles?limit=abc&offset=xyz' })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Category filter
// ---------------------------------------------------------------------------

describe('GET /api/articles?category_id', () => {
  it('filters articles by category', async () => {
    const cat = createCategory('Tech')
    const f1 = seedFeed({ category_id: cat.id, url: 'https://a.com' })
    const f2 = seedFeed({ url: 'https://b.com' })
    seedArticle(f1.id)
    seedArticle(f2.id)

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?category_id=${cat.id}`,
    })
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().total).toBe(1)
  })
})

describe('GET /api/articles feed icon metadata', () => {
  it('returns feed_icon_url for article list items', async () => {
    const feed = seedFeed({ icon_url: 'https://cdn.example.com/feed-icon.png' })
    seedArticle(feed.id)

    const res = await app.inject({ method: 'GET', url: '/api/articles' })

    expect(res.statusCode).toBe(200)
    expect(res.json().articles[0].feed_icon_url).toBe('https://cdn.example.com/feed-icon.png')
  })

  it('filters article list items by article_kind', async () => {
    const feed = seedFeed({ url: 'https://x.com/example', rss_url: 'https://rsshub.app/twitter/user/example' })
    seedArticle(feed.id, { url: 'https://x.com/example/status/1', article_kind: 'original' })
    seedArticle(feed.id, { url: 'https://x.com/example/status/2', article_kind: 'repost' })

    const res = await app.inject({ method: 'GET', url: `/api/articles?feed_id=${feed.id}&article_kind=repost` })

    expect(res.statusCode).toBe(200)
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().articles[0].article_kind).toBe('repost')
  })

  it('filters article list items by feed_view_type', async () => {
    const socialFeed = seedFeed({ url: 'https://x.com/example', rss_url: 'https://rsshub.app/twitter/user/example' })
    const articleFeed = seedFeed({ url: 'https://example.com/blog' })
    seedArticle(socialFeed.id, { url: 'https://x.com/example/status/1' })
    seedArticle(articleFeed.id, { url: 'https://example.com/post/1' })

    const res = await app.inject({ method: 'GET', url: '/api/articles?feed_view_type=social' })

    expect(res.statusCode).toBe(200)
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().articles[0].feed_view_type).toBe('social')
  })

  it('returns article_kind from by-url responses', async () => {
    const feed = seedFeed({ url: 'https://x.com/example', rss_url: 'https://rsshub.app/twitter/user/example' })
    seedArticle(feed.id, {
      url: 'https://x.com/example/status/3',
      article_kind: 'quote',
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles/by-url?url=${encodeURIComponent('https://x.com/example/status/3')}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().article_kind).toBe('quote')
  })

  it('returns resolved feed_view_type from list and by-url responses', async () => {
    const socialFeed = seedFeed({ url: 'https://x.com/example', rss_url: 'https://rsshub.app/twitter/user/example' })
    seedArticle(socialFeed.id, { url: 'https://x.com/example/status/4' })

    const listRes = await app.inject({ method: 'GET', url: `/api/articles?feed_id=${socialFeed.id}` })
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/articles/by-url?url=${encodeURIComponent('https://x.com/example/status/4')}`,
    })

    expect(listRes.statusCode).toBe(200)
    expect(listRes.json().articles[0].feed_view_type).toBe('social')
    expect(detailRes.statusCode).toBe(200)
    expect(detailRes.json().feed_view_type).toBe('social')
  })

  it('returns has_video from list and by-url responses', async () => {
    const feed = seedFeed()
    seedArticle(feed.id, {
      url: 'https://example.com/video',
      full_text: '<video src="https://video.example.com/post.mp4" controls></video>',
    })

    const listRes = await app.inject({ method: 'GET', url: `/api/articles?feed_id=${feed.id}` })
    expect(listRes.statusCode).toBe(200)
    expect(listRes.json().articles[0].has_video).toBe(true)

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/articles/by-url?url=${encodeURIComponent('https://example.com/video')}`,
    })
    expect(detailRes.statusCode).toBe(200)
    expect(detailRes.json().has_video).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Read filter
// ---------------------------------------------------------------------------

describe('GET /api/articles?read=1', () => {
  it('filters read articles', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id)
    seedArticle(feed.id)

    // Record a read
    await app.inject({ method: 'POST', url: `/api/articles/${artId}/read` })

    const res = await app.inject({ method: 'GET', url: '/api/articles?read=1' })
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().articles[0].read_at).not.toBeNull()
  })
})

describe('GET /api/articles?sort=inbox_score', () => {
  it('accepts inbox_score and returns the computed field', async () => {
    const feed = seedFeed()
    seedArticle(feed.id, {
      title: 'Unread candidate',
      url: 'https://example.com/inbox-score',
      published_at: new Date().toISOString(),
    })

    const res = await app.inject({ method: 'GET', url: '/api/articles?unread=1&sort=inbox_score' })

    expect(res.statusCode).toBe(200)
    expect(typeof res.json().articles[0].inbox_score).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// total_all: distinguish "no articles" from "all read"
// ---------------------------------------------------------------------------

describe('GET /api/articles?unread=1 — total_all field', () => {
  it('returns total_all when unread filter yields 0 results but articles exist', async () => {
    const feed = seedFeed()
    const artId1 = seedArticle(feed.id)
    const artId2 = seedArticle(feed.id)
    markArticleSeen(artId1, true)
    markArticleSeen(artId2, true)

    const res = await app.inject({ method: 'GET', url: '/api/articles?unread=1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().articles).toHaveLength(0)
    expect(res.json().total).toBe(0)
    expect(res.json().total_all).toBe(2)
  })

  it('returns total_all scoped to category_id', async () => {
    const cat = createCategory('News')
    const f1 = seedFeed({ category_id: cat.id, url: 'https://a.com' })
    const f2 = seedFeed({ url: 'https://b.com' })
    const a1 = seedArticle(f1.id)
    seedArticle(f2.id) // different category — should not count
    markArticleSeen(a1, true)

    const res = await app.inject({
      method: 'GET',
      url: `/api/articles?unread=1&category_id=${cat.id}`,
    })
    expect(res.json().articles).toHaveLength(0)
    expect(res.json().total_all).toBe(1)
  })

  it('does not include total_all when there are unread articles', async () => {
    const feed = seedFeed()
    seedArticle(feed.id) // unread

    const res = await app.inject({ method: 'GET', url: '/api/articles?unread=1' })
    expect(res.json().articles).toHaveLength(1)
    expect(res.json().total_all).toBeUndefined()
  })

  it('does not include total_all when no articles at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/articles?unread=1' })
    expect(res.json().articles).toHaveLength(0)
    expect(res.json().total).toBe(0)
    // total_all is 0, so it should still be included (to confirm "truly empty")
    expect(res.json().total_all).toBe(0)
  })

  it('does not include total_all for non-unread queries', async () => {
    const feed = seedFeed()
    seedArticle(feed.id)

    const res = await app.inject({ method: 'GET', url: '/api/articles' })
    expect(res.json().total_all).toBeUndefined()
  })
})

describe('GET /api/articles smart floor metadata', () => {
  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  }

  it('returns total_without_floor only on the first page', async () => {
    const feed = seedFeed()
    for (let i = 0; i < 5; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/route-twf-recent-${i}`,
        published_at: daysAgo(i),
      })
      markArticleSeen(id, true)
    }
    for (let i = 0; i < 20; i++) {
      const id = seedArticle(feed.id, {
        url: `https://example.com/route-twf-old-${i}`,
        published_at: daysAgo(30 + i),
      })
      markArticleSeen(id, true)
    }

    const firstPage = await app.inject({ method: 'GET', url: `/api/articles?feed_id=${feed.id}&limit=10&offset=0` })
    expect(firstPage.statusCode).toBe(200)
    expect(firstPage.json().total).toBeLessThan(25)
    expect(firstPage.json().total_without_floor).toBe(25)

    const secondPage = await app.inject({ method: 'GET', url: `/api/articles?feed_id=${feed.id}&limit=10&offset=10` })
    expect(secondPage.statusCode).toBe(200)
    expect(secondPage.json().articles).toHaveLength(10)
    expect(secondPage.json().total_without_floor).toBeUndefined()
  })
})

describe('PATCH /api/articles/batch-bookmark', () => {
  it('bookmarks multiple articles by id', async () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id)
    const id2 = seedArticle(feed.id)
    const id3 = seedArticle(feed.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/articles/batch-bookmark',
      headers: json,
      payload: { ids: [id1, id2], bookmarked: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ updated: 2 })

    const a1 = getArticleById(id1)
    const a2 = getArticleById(id2)
    const a3 = getArticleById(id3)
    expect(a1?.bookmarked_at).not.toBeNull()
    expect(a2?.bookmarked_at).not.toBeNull()
    expect(a3?.bookmarked_at).toBeNull()
  })

  it('validates request payload', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/articles/batch-bookmark',
      headers: json,
      payload: { ids: [] },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/inbox/topic-cooldowns', () => {
  it('returns 404 when the anchor article does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/topic-cooldowns',
      headers: json,
      payload: { anchor_article_id: 999999 },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('Article not found')
  })

  it('creates a cooldown for an existing article', async () => {
    const feed = seedFeed()
    const artId = seedArticle(feed.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/inbox/topic-cooldowns',
      headers: json,
      payload: { anchor_article_id: artId },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().anchor_article_id).toBe(artId)
  })
})
