import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { buildApp } from './__tests__/helpers/buildApp.js'
import { getDb, upsertSetting } from './db.js'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'

const mockVerifyAuthenticationResponse = vi.fn()

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const real = await importOriginal<typeof import('@simplewebauthn/server')>()
  return {
    ...real,
    verifyAuthenticationResponse: (...args: Parameters<typeof real.verifyAuthenticationResponse>) =>
      mockVerifyAuthenticationResponse(...args),
  }
})

let app: FastifyInstance
let savedAuthDisabled: string | undefined

function seedUser(email = 'test@example.com', password = 'password123') {
  const db = getDb()
  const hash = hashSync(password, 4)
  db.prepare("INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'owner', 'active')").run(email, hash)
}

function seedCredential(credentialId = 'cred-1', deviceType = 'multiDevice') {
  const db = getDb()
  db.prepare(`
    INSERT INTO credentials (credential_id, public_key, counter, device_type, backed_up)
    VALUES (?, ?, 0, ?, 0)
  `).run(credentialId, Buffer.from('fake-public-key'), deviceType)
}

async function getAuthToken(email = 'test@example.com', password = 'password123') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  })
  return res.json().token as string
}

beforeEach(async () => {
  setupTestDb()
  app = await buildApp()
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
  mockVerifyAuthenticationResponse.mockReset()
  mockVerifyAuthenticationResponse.mockResolvedValue({ verified: false })
})

afterEach(() => {
  if (savedAuthDisabled !== undefined) {
    process.env.AUTH_DISABLED = savedAuthDisabled
  } else {
    delete process.env.AUTH_DISABLED
  }
})

const json = { 'content-type': 'application/json' }

describe('GET /api/auth/methods', () => {
  it('returns setup_required true when no users exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.statusCode).toBe(200)
    expect(res.json().setup_required).toBe(true)
  })

  it('returns setup_required false when users exist', async () => {
    seedUser()
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.statusCode).toBe(200)
    expect(res.json().setup_required).toBe(false)
  })

  it('returns password enabled and no passkeys by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.password.enabled).toBe(true)
    expect(body.passkey.enabled).toBe(false)
    expect(body.passkey.count).toBe(0)
  })

  it('reflects passkey count when credentials exist', async () => {
    seedCredential('cred-1')
    seedCredential('cred-2')
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    const body = res.json()
    expect(body.passkey.enabled).toBe(true)
    expect(body.passkey.count).toBe(2)
  })

  it('reflects password disabled setting', async () => {
    upsertSetting('auth.password_enabled', '0')
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.json().password.enabled).toBe(false)
  })

  it('sets Cache-Control: no-store', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('GET /api/auth/register/options', () => {
  it('returns 401 without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/register/options' })
    expect(res.statusCode).toBe(401)
  })

  it('returns registration options with valid auth', async () => {
    seedUser()
    const token = await getAuthToken()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/register/options',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.challenge).toBeDefined()
    expect(body.challengeId).toEqual(expect.any(String))
    expect(body.rp).toBeDefined()
    expect(body.user).toBeDefined()
  })
})

describe('GET /api/auth/passkeys', () => {
  it('returns 401 without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/passkeys' })
    expect(res.statusCode).toBe(401)
  })

  it('returns empty list when no passkeys registered', async () => {
    seedUser()
    const token = await getAuthToken()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/passkeys',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('returns registered passkeys', async () => {
    seedUser()
    seedCredential('cred-1', 'multiDevice')
    const token = await getAuthToken()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/passkeys',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].credential_id).toBe('cred-1')
    expect(body[0].device_type).toBe('multiDevice')
  })
})

describe('POST /api/login with password disabled', () => {
  it('returns 403 when password auth is disabled', async () => {
    seedUser()
    upsertSetting('auth.password_enabled', '0')
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: json,
      payload: { email: 'test@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('Password authentication is disabled')
  })
})

describe('DELETE /api/auth/passkeys/:id', () => {
  it('returns 401 without authentication', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/auth/passkeys/1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for non-existent passkey', async () => {
    seedUser()
    const token = await getAuthToken()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/auth/passkeys/999',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('deletes a passkey when password is enabled', async () => {
    seedUser()
    seedCredential('cred-1')
    const token = await getAuthToken()

    const db = getDb()
    const row = db.prepare('SELECT id FROM credentials WHERE credential_id = ?').get('cred-1') as { id: number }

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/auth/passkeys/${row.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('prevents deleting last passkey when password is disabled (lockout prevention)', async () => {
    seedUser()
    seedCredential('cred-1')

    // Get token before disabling password
    const token = await getAuthToken()
    upsertSetting('auth.password_enabled', '0')

    const db = getDb()
    const row = db.prepare('SELECT id FROM credentials WHERE credential_id = ?').get('cred-1') as { id: number }

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/auth/passkeys/${row.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Cannot delete the last passkey')
  })
})

describe('POST /api/auth/password/toggle', () => {
  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/toggle',
      headers: json,
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when disabling password without passkeys', async () => {
    seedUser()
    const token = await getAuthToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/toggle',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Cannot disable password')
  })

  it('allows disabling password when passkeys exist', async () => {
    seedUser()
    seedCredential('cred-1')
    const token = await getAuthToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/toggle',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(false)
  })

  it('allows re-enabling password', async () => {
    seedUser()
    seedCredential('cred-1')
    upsertSetting('auth.password_enabled', '0')
    await getAuthToken()

    // Need to get token before disabling, let's use JWT directly
    const directToken = app.jwt.sign({ email: 'test@example.com', token_version: 0 })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/toggle',
      headers: { ...json, authorization: `Bearer ${directToken}` },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(true)
  })
})

describe('POST /api/auth/login/verify', () => {
  it('returns a challengeId with login options', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/login/options' })
    expect(res.statusCode).toBe(200)
    expect(res.json().challengeId).toEqual(expect.any(String))
  })

  it('returns 400 with no pending challenge', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login/verify',
      headers: json,
      payload: { id: 'fake-id', response: {} },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Challenge expired')
  })

  it('keeps concurrent login challenges independent', async () => {
    seedUser()
    seedCredential('cred-1')

    const opt1 = await app.inject({ method: 'GET', url: '/api/auth/login/options' })
    const opt2 = await app.inject({ method: 'GET', url: '/api/auth/login/options' })
    const challengeId1 = opt1.json().challengeId as string
    const challengeId2 = opt2.json().challengeId as string

    expect(challengeId1).toEqual(expect.any(String))
    expect(challengeId2).toEqual(expect.any(String))
    expect(challengeId1).not.toBe(challengeId2)

    const verify1 = await app.inject({
      method: 'POST',
      url: '/api/auth/login/verify',
      headers: json,
      payload: { challengeId: challengeId1, id: 'cred-1', response: {} },
    })
    expect(verify1.statusCode).toBe(400)
    expect(verify1.json().error).toBe('Authentication verification failed')

    const verify2 = await app.inject({
      method: 'POST',
      url: '/api/auth/login/verify',
      headers: json,
      payload: { challengeId: challengeId2, id: 'cred-1', response: {} },
    })
    expect(verify2.statusCode).toBe(400)
    expect(verify2.json().error).toBe('Authentication verification failed')
  })
})

describe('POST /api/auth/register/verify', () => {
  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register/verify',
      headers: json,
      payload: {},
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 with no pending challenge', async () => {
    seedUser()
    const token = await getAuthToken()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register/verify',
      headers: { ...json, authorization: `Bearer ${token}` },
      payload: { id: 'fake', response: {} },
    })
    expect(res.statusCode).toBe(400)
  })
})
