import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { buildApp } from './__tests__/helpers/buildApp.js'
import { createApiKey } from './db/apiKeys.js'
import { getDb } from './db/connection.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let savedAuthDisabled: string | undefined

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  savedAuthDisabled = process.env.AUTH_DISABLED
  // Enable AUTH_DISABLED so we can access token management without JWT setup
  process.env.AUTH_DISABLED = '1'
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

const json = { 'content-type': 'application/json' }

describe('API key management routes', () => {
  describe('POST /api/settings/tokens', () => {
    it('creates a new API key with read scope by default', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/settings/tokens',
        headers: json,
        payload: { name: 'My Script' },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.key).toMatch(/^ok_[0-9a-f]{40}$/)
      expect(body.name).toBe('My Script')
      expect(body.scopes).toBe('read')
    })

    it('creates a key with read,write scope', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/settings/tokens',
        headers: json,
        payload: { name: 'Admin Key', scopes: 'read,write' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().scopes).toBe('read,write')
    })

    it('rejects invalid scopes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/settings/tokens',
        headers: json,
        payload: { name: 'Bad', scopes: 'admin' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects empty name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/settings/tokens',
        headers: json,
        payload: { name: '' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('GET /api/settings/tokens', () => {
    it('returns empty list when no keys exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/settings/tokens' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })

    it('returns created keys without full key value', async () => {
      createApiKey('key-1')
      createApiKey('key-2')
      const res = await app.inject({ method: 'GET', url: '/api/settings/tokens' })
      expect(res.statusCode).toBe(200)
      const keys = res.json()
      expect(keys).toHaveLength(2)
      expect(keys[0]).not.toHaveProperty('key')
      expect(keys[0]).not.toHaveProperty('key_hash')
      expect(keys[0]).toHaveProperty('name')
      expect(keys[0]).toHaveProperty('key_prefix')
    })
  })

  describe('DELETE /api/settings/tokens/:id', () => {
    it('deletes an existing key', async () => {
      const created = createApiKey('to-delete')
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/settings/tokens/${created.id}`,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    })

    it('returns 404 for non-existent key', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/settings/tokens/999',
      })
      expect(res.statusCode).toBe(404)
    })
  })
})

describe('API key authentication', () => {
  beforeEach(() => {
    // Disable AUTH_DISABLED so we can test real auth
    delete process.env.AUTH_DISABLED
  })

  it('allows access with a valid API key', async () => {
    // Re-enable to create the key
    process.env.AUTH_DISABLED = '1'
    const created = createApiKey('test-access', 'read')
    delete process.env.AUTH_DISABLED

    const res = await app.inject({
      method: 'GET',
      url: '/api/categories',
      headers: { authorization: `Bearer ${created.key}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 401 for invalid API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/categories',
      headers: { authorization: 'Bearer ok_0000000000000000000000000000000000000000' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid API key')
  })

  it('returns 401 when no auth header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/categories',
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('API key scope enforcement', () => {
  beforeEach(() => {
    delete process.env.AUTH_DISABLED
  })

  it('allows GET requests with read-only scope', async () => {
    process.env.AUTH_DISABLED = '1'
    const created = createApiKey('reader', 'read')
    delete process.env.AUTH_DISABLED

    const res = await app.inject({
      method: 'GET',
      url: '/api/feeds',
      headers: { authorization: `Bearer ${created.key}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('blocks POST requests with read-only scope', async () => {
    process.env.AUTH_DISABLED = '1'
    const created = createApiKey('reader', 'read')
    delete process.env.AUTH_DISABLED

    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: {
        authorization: `Bearer ${created.key}`,
        'content-type': 'application/json',
      },
      payload: { name: 'test' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('API key does not have write scope')
  })

  it('allows POST requests with read,write scope', async () => {
    process.env.AUTH_DISABLED = '1'
    const created = createApiKey('writer', 'read,write')
    delete process.env.AUTH_DISABLED

    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      headers: {
        authorization: `Bearer ${created.key}`,
        'content-type': 'application/json',
      },
      payload: { name: 'new-category' },
    })
    // Should not be 403 (might be 200 or other, but not forbidden)
    expect(res.statusCode).not.toBe(403)
  })
})

describe('GET /api/stats', () => {
  it('returns aggregate stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/stats',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('total_articles')
    expect(body).toHaveProperty('unread_articles')
    expect(body).toHaveProperty('read_articles')
    expect(body).toHaveProperty('bookmarked_articles')
    expect(body).toHaveProperty('liked_articles')
    expect(body).toHaveProperty('total_feeds')
    expect(body).toHaveProperty('total_categories')
    expect(body).toHaveProperty('by_feed')
    expect(body.total_articles).toBe(0)
    expect(body.total_feeds).toBe(0)
  })

  it('reads metadata and collection counts with one auxiliary query', async () => {
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/stats',
    })

    expect(res.statusCode).toBe(200)
    expect(preparedSql.some(sql =>
      sql.includes('AS feed_count') &&
      sql.includes('AS category_count') &&
      sql.includes('AS bookmark_count') &&
      sql.includes('AS like_count'),
    )).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT COUNT(*) AS cnt FROM feeds'))).toBe(false)
    expect(preparedSql.some(sql => sql.includes('SELECT COUNT(*) AS cnt FROM categories'))).toBe(false)
    expect(preparedSql.filter(sql =>
      sql.includes('FROM active_articles') &&
      sql.includes('bookmarked_at IS NOT NULL') &&
      sql.includes('liked_at IS NOT NULL'),
    )).toHaveLength(1)
  })
})
