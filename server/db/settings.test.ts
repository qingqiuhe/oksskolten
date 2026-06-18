import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createUser, getDb, getSetting, getSettings, upsertSetting, deleteSetting, getOrCreateJwtSecret } from '../db.js'

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

describe('getSettings', () => {
  it('returns values for multiple legacy settings', () => {
    upsertSetting('foo', 'bar')
    upsertSetting('baz', 'qux')

    expect(getSettings(['foo', 'baz', 'missing'])).toEqual({
      foo: 'bar',
      baz: 'qux',
      missing: undefined,
    })
  })

  it('uses user settings without falling back to legacy user-scoped keys', () => {
    const user = createUser({
      email: 'settings-user@example.com',
      passwordHash: 'hash',
      role: 'member',
      status: 'active',
    })
    upsertSetting('chat.provider', 'legacy-provider')
    upsertSetting('chat.provider', 'openai', user.id)

    expect(getSettings(['chat.provider', 'chat.model'], user.id)).toEqual({
      'chat.provider': 'openai',
      'chat.model': undefined,
    })
  })

  it('uses instance settings before legacy settings', () => {
    upsertSetting('system.jwt_secret', 'instance-secret')
    getDb().prepare(`
      INSERT INTO settings (key, value)
      VALUES ('system.jwt_secret', 'legacy-secret')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run()

    expect(getSettings(['system.jwt_secret'])).toEqual({
      'system.jwt_secret': 'instance-secret',
    })
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
  it('does not fall back to legacy api keys for logged-in users', () => {
    upsertSetting('api_key.openai', 'legacy-secret')

    expect(getSetting('api_key.openai', 42)).toBeUndefined()
  })

  it('does not fall back to legacy ollama custom headers for logged-in users', () => {
    upsertSetting('ollama.custom_headers', '{"Authorization":"Bearer legacy"}')

    expect(getSetting('ollama.custom_headers', 42)).toBeUndefined()
  })

  it('does not fall back to legacy openai base URLs for logged-in users', () => {
    upsertSetting('openai.base_url', 'https://legacy.example/v1')

    expect(getSetting('openai.base_url', 42)).toBeUndefined()
  })
})
