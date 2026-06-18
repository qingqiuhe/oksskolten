import { randomBytes } from 'node:crypto'
import { getDb } from './connection.js'
import { logger } from '../logger.js'
import { getCurrentUserId } from '../identity.js'

const log = logger.child('db')

const INSTANCE_PREFIXES = ['auth.', 'system.', 'images.', 'social.'] as const
const LEGACY_INSTANCE_FALLBACK_KEYS = new Set<string>()

function isInstanceSetting(key: string): boolean {
  return INSTANCE_PREFIXES.some(prefix => key.startsWith(prefix))
}

function shouldFallbackToLegacyForUserScopedKey(key: string): boolean {
  return LEGACY_INSTANCE_FALLBACK_KEYS.has(key)
}

function resolveUserId(userId?: number | null): number | null {
  return userId ?? getCurrentUserId()
}

export function getInstanceSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM instance_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function upsertInstanceSetting(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO instance_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

export function deleteInstanceSetting(key: string): void {
  getDb().prepare('DELETE FROM instance_settings WHERE key = ?').run(key)
}

export function getUserSetting(userId: number, key: string): string | undefined {
  const row = getDb().prepare(`
    SELECT value
    FROM user_settings
    WHERE user_id = ? AND key = ?
  `).get(userId, key) as { value: string } | undefined
  return row?.value
}

export function upsertUserSetting(userId: number, key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO user_settings (user_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE
    SET value = excluded.value, updated_at = datetime('now')
  `).run(userId, key, value)
}

export function deleteUserSetting(userId: number, key: string): void {
  getDb().prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').run(userId, key)
}

function getLegacySetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function getSetting(key: string, userId?: number | null): string | undefined {
  if (isInstanceSetting(key)) {
    return getInstanceSetting(key) ?? getLegacySetting(key)
  }

  const scopedUserId = resolveUserId(userId)
  if (scopedUserId != null) {
    const userValue = getUserSetting(scopedUserId, key)
    if (userValue !== undefined) return userValue
    return shouldFallbackToLegacyForUserScopedKey(key) ? getLegacySetting(key) : undefined
  }

  return getLegacySetting(key)
}

export function getSettings(keys: readonly string[], userId?: number | null): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = Object.fromEntries(keys.map(key => [key, undefined]))
  const uniqueKeys = [...new Set(keys)]
  if (uniqueKeys.length === 0) return result

  const instanceKeys = uniqueKeys.filter(isInstanceSetting)
  if (instanceKeys.length > 0) {
    const placeholders = instanceKeys.map(() => '?').join(', ')
    const instanceRows = getDb().prepare(`
      SELECT key, value
      FROM instance_settings
      WHERE key IN (${placeholders})
    `).all(...instanceKeys) as Array<{ key: string; value: string }>
    for (const row of instanceRows) result[row.key] = row.value

    const missingInstanceKeys = instanceKeys.filter(key => result[key] === undefined)
    if (missingInstanceKeys.length > 0) {
      const legacyPlaceholders = missingInstanceKeys.map(() => '?').join(', ')
      const legacyRows = getDb().prepare(`
        SELECT key, value
        FROM settings
        WHERE key IN (${legacyPlaceholders})
      `).all(...missingInstanceKeys) as Array<{ key: string; value: string }>
      for (const row of legacyRows) result[row.key] = row.value
    }
  }

  const regularKeys = uniqueKeys.filter(key => !isInstanceSetting(key))
  if (regularKeys.length === 0) return result

  const scopedUserId = resolveUserId(userId)
  const placeholders = regularKeys.map(() => '?').join(', ')
  if (scopedUserId != null) {
    const userRows = getDb().prepare(`
      SELECT key, value
      FROM user_settings
      WHERE user_id = ? AND key IN (${placeholders})
    `).all(scopedUserId, ...regularKeys) as Array<{ key: string; value: string }>
    for (const row of userRows) result[row.key] = row.value

    const fallbackKeys = regularKeys.filter(key => result[key] === undefined && shouldFallbackToLegacyForUserScopedKey(key))
    if (fallbackKeys.length > 0) {
      const fallbackPlaceholders = fallbackKeys.map(() => '?').join(', ')
      const legacyRows = getDb().prepare(`
        SELECT key, value
        FROM settings
        WHERE key IN (${fallbackPlaceholders})
      `).all(...fallbackKeys) as Array<{ key: string; value: string }>
      for (const row of legacyRows) result[row.key] = row.value
    }
    return result
  }

  const legacyRows = getDb().prepare(`
    SELECT key, value
    FROM settings
    WHERE key IN (${placeholders})
  `).all(...regularKeys) as Array<{ key: string; value: string }>
  for (const row of legacyRows) result[row.key] = row.value
  return result
}

export function upsertSetting(key: string, value: string, userId?: number | null): void {
  if (isInstanceSetting(key)) {
    upsertInstanceSetting(key, value)
    return
  }

  const scopedUserId = resolveUserId(userId)
  if (scopedUserId != null) {
    upsertUserSetting(scopedUserId, key, value)
    return
  }

  getDb().prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

export function deleteSetting(key: string, userId?: number | null): void {
  if (isInstanceSetting(key)) {
    deleteInstanceSetting(key)
    return
  }

  const scopedUserId = resolveUserId(userId)
  if (scopedUserId != null) {
    deleteUserSetting(scopedUserId, key)
    return
  }

  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function getOrCreateJwtSecret(): string {
  const existing = getInstanceSetting('system.jwt_secret') ?? getSetting('system.jwt_secret')
  if (existing) return existing
  const secret = randomBytes(64).toString('base64url')
  upsertInstanceSetting('system.jwt_secret', secret)
  log.info('Generated new JWT secret and persisted to database')
  return secret
}
