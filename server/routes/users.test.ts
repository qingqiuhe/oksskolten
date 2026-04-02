import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createCategory, createFeed, getDb } from '../db.js'
import { roleCanManage } from '../identity.js'

const mockFetchSingleFeed = vi.fn()

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: (...args: unknown[]) => mockFetchSingleFeed(...args),
    discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
    summarizeArticle: vi.fn(),
    streamSummarizeArticle: vi.fn(),
    translateArticle: vi.fn(),
    streamTranslateArticle: vi.fn(),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
  }
})

vi.mock('../anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

beforeEach(async () => {
  process.env.AUTH_DISABLED = '1'
  setupTestDb()
  app = await buildApp()
  mockFetchSingleFeed.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/users import subscriptions', () => {
  it('imports selected feeds and creates minimal category mapping', async () => {
    const tech = createCategory('Tech')
    const news = createCategory('News')
    const feedA = createFeed({ name: 'Feed A', url: 'https://a.example.com', rss_url: 'https://a.example.com/rss', category_id: tech.id })
    const feedB = createFeed({ name: 'Feed B', url: 'https://b.example.com', rss_url: 'https://b.example.com/rss', category_id: tech.id })
    createFeed({ name: 'Feed C', url: 'https://c.example.com', rss_url: 'https://c.example.com/rss', category_id: news.id })
    const uncategorized = createFeed({ name: 'Feed D', url: 'https://d.example.com', rss_url: null, rss_bridge_url: 'https://bridge.example.com/d' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: json,
      payload: {
        email: 'invitee@example.com',
        role: 'member',
        import_feed_ids: [feedA.id, feedB.id, uncategorized.id],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().import_result).toEqual({
      imported_feed_count: 3,
      imported_category_count: 1,
    })

    const invited = getDb().prepare('SELECT id FROM users WHERE email = ?').get('invitee@example.com') as { id: number }
    const importedFeeds = getDb().prepare(`
      SELECT name, url, rss_url, rss_bridge_url, category_id, disabled, last_error, next_check_at
      FROM feeds
      WHERE user_id = ?
      ORDER BY name
    `).all(invited.id) as Array<{
      name: string
      url: string
      rss_url: string | null
      rss_bridge_url: string | null
      category_id: number | null
      disabled: number
      last_error: string | null
      next_check_at: string | null
    }>

    expect(importedFeeds).toHaveLength(3)
    expect(importedFeeds.every(feed => feed.disabled === 0)).toBe(true)
    expect(importedFeeds.every(feed => feed.last_error === null)).toBe(true)
    expect(importedFeeds.every(feed => feed.next_check_at === null)).toBe(true)
    expect(importedFeeds.filter(feed => feed.category_id !== null)).toHaveLength(2)

    const importedCategories = getDb().prepare('SELECT name FROM categories WHERE user_id = ? ORDER BY name').all(invited.id) as Array<{ name: string }>
    expect(importedCategories).toEqual([{ name: 'Tech' }])

    expect(mockFetchSingleFeed).toHaveBeenCalledTimes(3)
  })

  it('rejects feeds outside the inviter scope', async () => {
    createFeed({ name: 'Allowed', url: 'https://allowed.example.com', rss_url: 'https://allowed.example.com/rss' })
    const foreignFeedId = 9999

    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: json,
      payload: {
        email: 'invitee@example.com',
        role: 'member',
        import_feed_ids: [foreignFeedId],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Invalid import feed selection/)
  })

  it('rejects clip feeds and keeps admin role restriction', async () => {
    const clipFeed = createFeed({ name: 'Clips', url: 'clip://saved', type: 'clip' })

    const clipRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: json,
      payload: {
        email: 'member1@example.com',
        role: 'member',
        import_feed_ids: [clipFeed.id],
      },
    })

    expect(clipRes.statusCode).toBe(400)
    expect(clipRes.json().error).toMatch(/Clip feeds cannot be imported/)

    expect(roleCanManage('admin', 'member')).toBe(true)
    expect(roleCanManage('admin', 'admin')).toBe(false)
  })
})
