import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { getDb, upsertSetting } from './db.js'
import { hashSync } from 'bcryptjs'
import { oauthRoutes, isGitHubOAuthEnabled } from './oauthRoutes.js'
import { authRoutes } from './authRoutes.js'

let app: FastifyInstance
let savedAuthDisabled: string | undefined

const json = { 'content-type': 'application/json' }

function seedUser(email = 'test@example.com', password = 'password123') {
  const db = getDb()
  const hash = hashSync(password, 4)
  db.prepare("INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'owner', 'active')").run(email, hash)
}

function enableGitHubOAuth(clientId = 'test-client-id', clientSecret = 'test-client-secret') {
  upsertSetting('auth.github_client_id', clientId)
  upsertSetting('auth.github_client_secret', clientSecret)
  upsertSetting('auth.github_enabled', '1')
}

function getToken(): string {
  const db = getDb()
  const user = db.prepare('SELECT email, token_version FROM users LIMIT 1').get() as { email: string; token_version: number }
  return app.jwt.sign({ email: user.email, token_version: user.token_version })
}

async function buildOAuthApp() {
  const app = Fastify()
  await app.register(jwt, { secret: 'test-secret', sign: { expiresIn: '30d' } })
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await app.register(authRoutes)
  await app.register(oauthRoutes)
  return app
}

beforeEach(async () => {
  setupTestDb()
  app = await buildOAuthApp()
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

// ---------------------------------------------------------------------------
// isGitHubOAuthEnabled
// ---------------------------------------------------------------------------
describe('isGitHubOAuthEnabled', () => {
  it('returns false when not configured', () => {
    expect(isGitHubOAuthEnabled()).toBe(false)
  })

  it('returns false when enabled but missing client id', () => {
    upsertSetting('auth.github_enabled', '1')
    upsertSetting('auth.github_client_secret', 'secret')
    expect(isGitHubOAuthEnabled()).toBe(false)
  })

  it('returns false when enabled but missing client secret', () => {
    upsertSetting('auth.github_enabled', '1')
    upsertSetting('auth.github_client_id', 'id')
    expect(isGitHubOAuthEnabled()).toBe(false)
  })

  it('returns false when configured but not enabled', () => {
    upsertSetting('auth.github_client_id', 'id')
    upsertSetting('auth.github_client_secret', 'secret')
    expect(isGitHubOAuthEnabled()).toBe(false)
  })

  it('returns true when fully configured and enabled', () => {
    enableGitHubOAuth()
    expect(isGitHubOAuthEnabled()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /api/oauth/github/authorize
// ---------------------------------------------------------------------------
describe('POST /api/oauth/github/authorize', () => {
  it('returns 400 when OAuth is not enabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/authorize',
      headers: json,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not enabled/)
  })

  it('returns authorization URL when enabled', async () => {
    enableGitHubOAuth()
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/authorize',
      headers: { ...json, origin: 'https://rss.example.com' },
      payload: { origin: 'https://rss.example.com' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.url).toContain('github.com')
    expect(body.url).toContain('test-client-id')
  })
})

// ---------------------------------------------------------------------------
// GET /api/oauth/github/callback
// ---------------------------------------------------------------------------
describe('GET /api/oauth/github/callback', () => {
  it('redirects with invalid_state when state is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/github/callback?code=abc',
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('oauth_error=invalid_state')
  })

  it('redirects with invalid_state when state is unknown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/github/callback?code=abc&state=bogus',
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('oauth_error=invalid_state')
  })

  it('redirects with missing_code when code is absent', async () => {
    // First, trigger authorize to get a valid state
    enableGitHubOAuth()
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/authorize',
      headers: json,
      payload: { origin: 'http://localhost' },
    })
    const authUrl = new URL(authRes.json().url)
    const state = authUrl.searchParams.get('state')

    const res = await app.inject({
      method: 'GET',
      url: `/api/oauth/github/callback?state=${state}`,
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('oauth_error=missing_code')
  })
})

// ---------------------------------------------------------------------------
// POST /api/oauth/github/token
// ---------------------------------------------------------------------------
describe('POST /api/oauth/github/token', () => {
  it('returns 400 when code is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/token',
      headers: json,
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Missing code/)
  })

  it('returns 400 for invalid exchange code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/token',
      headers: json,
      payload: { code: 'nonexistent' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Invalid or expired/)
  })
})

// ---------------------------------------------------------------------------
// GET /api/oauth/github/config
// ---------------------------------------------------------------------------
describe('GET /api/oauth/github/config', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/github/config',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns config when authenticated', async () => {
    seedUser()
    enableGitHubOAuth()
    const token = getToken()

    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/github/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.enabled).toBe(true)
    expect(body.configured).toBe(true)
    expect(body.clientId).toBe('test-client-id')
  })

  it('returns unconfigured state when no credentials', async () => {
    seedUser()
    const token = getToken()

    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/github/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.enabled).toBe(false)
    expect(body.configured).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// POST /api/oauth/github/config
// ---------------------------------------------------------------------------
describe('POST /api/oauth/github/config', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/config',
      headers: json,
      payload: { clientId: 'id' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('saves client id and secret', async () => {
    seedUser()
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/config',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { clientId: 'new-id', clientSecret: 'new-secret' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().clientId).toBe('new-id')
    expect(res.json().configured).toBe(true)
  })

  it('ignores empty clientSecret (does not clear)', async () => {
    seedUser()
    enableGitHubOAuth()
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/config',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { clientSecret: '' },
    })
    expect(res.statusCode).toBe(200)
    // configured should still be true because secret was not cleared
    expect(res.json().configured).toBe(true)
  })

  it('saves allowed users', async () => {
    seedUser()
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/config',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { allowedUsers: 'user1, user2' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowedUsers).toBe('user1, user2')
  })

  it('prevents clearing client id when OAuth is only auth method', async () => {
    seedUser()
    enableGitHubOAuth()
    upsertSetting('auth.password_enabled', '0')
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/config',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { clientId: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Cannot clear Client ID/)
  })

  it('prevents clearing client secret when OAuth is only auth method', async () => {
    seedUser()
    enableGitHubOAuth()
    upsertSetting('auth.password_enabled', '0')
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/config',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { clientSecret: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Cannot clear Client Secret/)
  })

  it('allows clearing when password is also enabled', async () => {
    seedUser()
    enableGitHubOAuth()
    // password_enabled defaults to not '0', so it's enabled
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/config',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { clientId: '' },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// POST /api/oauth/github/toggle
// ---------------------------------------------------------------------------
describe('POST /api/oauth/github/toggle', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/toggle',
      headers: json,
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when enabling without config', async () => {
    seedUser()
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/toggle',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not configured/)
  })

  it('enables OAuth when configured', async () => {
    seedUser()
    upsertSetting('auth.github_client_id', 'id')
    upsertSetting('auth.github_client_secret', 'secret')
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/toggle',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(true)
  })

  it('disables OAuth when password is enabled', async () => {
    seedUser()
    enableGitHubOAuth()
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/toggle',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(false)
  })

  it('prevents disabling when it is the only auth method', async () => {
    seedUser()
    enableGitHubOAuth()
    upsertSetting('auth.password_enabled', '0')
    const token = getToken()

    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/github/toggle',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Cannot disable/)
  })
})
