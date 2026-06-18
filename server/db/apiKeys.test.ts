import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { clearApiKeyUsageWriteCacheForTests, createApiKey, listApiKeys, deleteApiKey, validateApiKey } from './apiKeys.js'
import { getDb } from './connection.js'

beforeEach(() => {
  setupTestDb()
  clearApiKeyUsageWriteCacheForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('apiKeys', () => {
  describe('createApiKey', () => {
    it('returns a key with ok_ prefix', () => {
      const result = createApiKey('test key')
      expect(result.key).toMatch(/^ok_[0-9a-f]{40}$/)
      expect(result.key_prefix).toBe(result.key.slice(0, 11))
      expect(result.name).toBe('test key')
      expect(result.scopes).toBe('read')
      expect(result.id).toBeGreaterThan(0)
    })

    it('respects custom scopes', () => {
      const result = createApiKey('rw key', 'read,write')
      expect(result.scopes).toBe('read,write')
    })

    it('generates unique keys each time', () => {
      const a = createApiKey('key-a')
      const b = createApiKey('key-b')
      expect(a.key).not.toBe(b.key)
      expect(a.id).not.toBe(b.id)
    })
  })

  describe('listApiKeys', () => {
    it('returns empty array when no keys exist', () => {
      expect(listApiKeys()).toEqual([])
    })

    it('returns keys without the full key value', () => {
      createApiKey('my key')
      const keys = listApiKeys()
      expect(keys).toHaveLength(1)
      expect(keys[0].name).toBe('my key')
      expect(keys[0].key_prefix).toMatch(/^ok_[0-9a-f]{8}$/)
      expect(keys[0]).not.toHaveProperty('key')
      expect(keys[0]).not.toHaveProperty('key_hash')
    })

    it('lists multiple keys', () => {
      createApiKey('first')
      createApiKey('second')
      const keys = listApiKeys()
      expect(keys).toHaveLength(2)
      const names = keys.map(k => k.name)
      expect(names).toContain('first')
      expect(names).toContain('second')
    })
  })

  describe('deleteApiKey', () => {
    it('deletes an existing key and returns true', () => {
      const { id } = createApiKey('to-delete')
      expect(deleteApiKey(id)).toBe(true)
      expect(listApiKeys()).toHaveLength(0)
    })

    it('returns false for non-existent id', () => {
      expect(deleteApiKey(999)).toBe(false)
    })
  })

  describe('validateApiKey', () => {
    it('returns id and scopes for a valid key', () => {
      const created = createApiKey('valid', 'read,write')
      const result = validateApiKey(created.key)
      expect(result).toMatchObject({ id: created.id, scopes: 'read,write' })
    })

    it('returns null for an invalid key', () => {
      expect(validateApiKey('ok_0000000000000000000000000000000000000000')).toBeNull()
    })

    it('returns null for a non-ok_ prefixed string', () => {
      expect(validateApiKey('not-a-key')).toBeNull()
    })

    it('updates last_used_at on successful validation', () => {
      const created = createApiKey('track-usage')
      expect(listApiKeys()[0].last_used_at).toBeNull()

      validateApiKey(created.key)

      const keys = listApiKeys()
      expect(keys[0].last_used_at).not.toBeNull()
    })

    it('throttles last_used_at writes for repeated validations', () => {
      const created = createApiKey('busy-client')
      const db = getDb()
      const originalPrepare = db.prepare.bind(db)
      const preparedSql: string[] = []
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        preparedSql.push(sql)
        return originalPrepare(sql)
      })

      validateApiKey(created.key)
      validateApiKey(created.key)

      expect(preparedSql.filter(sql => sql.includes('UPDATE api_keys SET last_used_at'))).toHaveLength(1)
    })

    it('refreshes last_used_at again after the throttle window', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T00:00:00Z'))
      const created = createApiKey('periodic-audit')
      const db = getDb()
      const originalPrepare = db.prepare.bind(db)
      const preparedSql: string[] = []
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        preparedSql.push(sql)
        return originalPrepare(sql)
      })

      validateApiKey(created.key)
      vi.setSystemTime(new Date('2026-06-10T00:01:01Z'))
      validateApiKey(created.key)

      expect(preparedSql.filter(sql => sql.includes('UPDATE api_keys SET last_used_at'))).toHaveLength(2)
    })

    it('returns null after key is deleted', () => {
      const created = createApiKey('ephemeral')
      deleteApiKey(created.id)
      expect(validateApiKey(created.key)).toBeNull()
    })
  })
})
