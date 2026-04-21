import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { getDb, getSetting, upsertSetting, deleteSetting, getOrCreateJwtSecret, upsertUserSetting } from '../db.js'

function insertActiveUser(userId: number, email = `user-${userId}@example.com`) {
  getDb().prepare(`
    INSERT INTO users (id, email, password_hash, role, status)
    VALUES (?, ?, ?, 'member', 'active')
  `).run(userId, email, 'hash')
}

beforeEach(() => {
  setupTestDb()
})

describe('getSetting', () => {
  it('returns undefined for non-existent key', () => {
    expect(getSetting('nonexistent')).toBeUndefined()
  })

  it('returns value for existing key', () => {
    upsertSetting('foo', 'bar')
    expect(getSetting('foo')).toBe('bar')
  })
})

describe('upsertSetting', () => {
  it('inserts a new setting', () => {
    upsertSetting('key1', 'value1')
    expect(getSetting('key1')).toBe('value1')
  })

  it('updates an existing setting on conflict', () => {
    upsertSetting('key1', 'value1')
    upsertSetting('key1', 'value2')
    expect(getSetting('key1')).toBe('value2')
  })

  it('handles empty string value', () => {
    upsertSetting('key1', '')
    expect(getSetting('key1')).toBe('')
  })

  it('handles very long values', () => {
    const long = 'x'.repeat(10_000)
    upsertSetting('key1', long)
    expect(getSetting('key1')).toBe(long)
  })
})

describe('deleteSetting', () => {
  it('deletes an existing setting', () => {
    upsertSetting('key1', 'value1')
    deleteSetting('key1')
    expect(getSetting('key1')).toBeUndefined()
  })

  it('does nothing for non-existent key', () => {
    expect(() => deleteSetting('nonexistent')).not.toThrow()
  })
})

describe('getOrCreateJwtSecret', () => {
  it('generates and persists a new secret on first call', () => {
    const secret = getOrCreateJwtSecret()
    expect(secret).toBeTruthy()
    expect(typeof secret).toBe('string')
    expect(secret.length).toBeGreaterThan(0)
    // Verify it was persisted
    expect(getSetting('system.jwt_secret')).toBe(secret)
  })

  it('returns the same secret on subsequent calls', () => {
    const first = getOrCreateJwtSecret()
    const second = getOrCreateJwtSecret()
    expect(first).toBe(second)
  })

  it('returns pre-existing secret without overwriting', () => {
    upsertSetting('system.jwt_secret', 'my-preset-secret')
    const secret = getOrCreateJwtSecret()
    expect(secret).toBe('my-preset-secret')
  })

  it('generates a base64url-encoded secret', () => {
    const secret = getOrCreateJwtSecret()
    // base64url uses only [A-Za-z0-9_-]
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('legacy fallback for user-scoped reads', () => {
  it('falls back to legacy instance config keys for logged-in users', () => {
    upsertSetting('openai.base_url', 'https://legacy.example/v1')

    expect(getSetting('openai.base_url', 42)).toBe('https://legacy.example/v1')
  })

  it('prefers user-scoped value over legacy fallback for instance config keys', () => {
    insertActiveUser(42)
    upsertSetting('openai.base_url', 'https://legacy.example/v1')
    upsertUserSetting(42, 'openai.base_url', 'https://user.example/v1')

    expect(getSetting('openai.base_url', 42)).toBe('https://user.example/v1')
  })

  it('does not fall back to legacy api keys for logged-in users', () => {
    upsertSetting('api_key.openai', 'legacy-secret')

    expect(getSetting('api_key.openai', 42)).toBeUndefined()
  })
})
