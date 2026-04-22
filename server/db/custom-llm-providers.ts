import { getCurrentUserId } from '../identity.js'
import { getDb } from './connection.js'

export interface CustomLLMProvider {
  id: number
  user_id: number
  name: string
  kind: 'openai-compatible'
  base_url: string
  has_api_key: boolean
  created_at: string
  updated_at: string
}

export interface CustomLLMProviderSecret extends Omit<CustomLLMProvider, 'has_api_key'> {
  api_key: string
}

function resolveRequiredUserId(userId?: number | null): number {
  const resolved = userId ?? getCurrentUserId()
  if (resolved != null) {
    return resolved
  }

  const existing = getDb().prepare(`
    SELECT id
    FROM users
    ORDER BY id ASC
    LIMIT 1
  `).get() as { id: number } | undefined
  if (existing) {
    return existing.id
  }

  const created = getDb().prepare(`
    INSERT INTO users (email, password_hash, role, status)
    VALUES ('local@localhost', '', 'owner', 'active')
  `).run()
  return Number(created.lastInsertRowid)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function mapRow(row: Record<string, unknown>): CustomLLMProvider {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    name: String(row.name),
    kind: 'openai-compatible',
    base_url: String(row.base_url),
    has_api_key: Boolean(row.api_key),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function mapSecretRow(row: Record<string, unknown>): CustomLLMProviderSecret {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    name: String(row.name),
    kind: 'openai-compatible',
    base_url: String(row.base_url),
    api_key: String(row.api_key),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function listCustomLLMProviders(userId?: number | null): CustomLLMProvider[] {
  const scopedUserId = resolveRequiredUserId(userId)
  const rows = getDb().prepare(`
    SELECT id, user_id, name, kind, base_url, api_key, created_at, updated_at
    FROM custom_llm_providers
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(scopedUserId) as Array<Record<string, unknown>>
  return rows.map(mapRow)
}

export function getCustomLLMProviderById(id: number, userId?: number | null): CustomLLMProvider | undefined {
  const scopedUserId = resolveRequiredUserId(userId)
  const row = getDb().prepare(`
    SELECT id, user_id, name, kind, base_url, api_key, created_at, updated_at
    FROM custom_llm_providers
    WHERE id = ? AND user_id = ?
  `).get(id, scopedUserId) as Record<string, unknown> | undefined
  return row ? mapRow(row) : undefined
}

export function getCustomLLMProviderSecretById(id: number, userId?: number | null): CustomLLMProviderSecret | undefined {
  const scopedUserId = resolveRequiredUserId(userId)
  const row = getDb().prepare(`
    SELECT id, user_id, name, kind, base_url, api_key, created_at, updated_at
    FROM custom_llm_providers
    WHERE id = ? AND user_id = ?
  `).get(id, scopedUserId) as Record<string, unknown> | undefined
  return row ? mapSecretRow(row) : undefined
}

export function createCustomLLMProvider(input: {
  name: string
  base_url: string
  api_key: string
}, userId?: number | null): CustomLLMProvider {
  const scopedUserId = resolveRequiredUserId(userId)
  const info = getDb().prepare(`
    INSERT INTO custom_llm_providers (user_id, name, kind, base_url, api_key)
    VALUES (?, ?, 'openai-compatible', ?, ?)
  `).run(scopedUserId, input.name.trim(), normalizeBaseUrl(input.base_url), input.api_key.trim())
  return getCustomLLMProviderById(Number(info.lastInsertRowid), scopedUserId)!
}

export function updateCustomLLMProvider(id: number, input: {
  name?: string
  base_url?: string
  api_key?: string
}, userId?: number | null): CustomLLMProvider | undefined {
  const scopedUserId = resolveRequiredUserId(userId)
  const existing = getCustomLLMProviderSecretById(id, scopedUserId)
  if (!existing) return undefined

  getDb().prepare(`
    UPDATE custom_llm_providers
    SET
      name = ?,
      base_url = ?,
      api_key = ?,
      updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    input.name?.trim() || existing.name,
    input.base_url ? normalizeBaseUrl(input.base_url) : existing.base_url,
    input.api_key?.trim() || existing.api_key,
    id,
    scopedUserId,
  )

  return getCustomLLMProviderById(id, scopedUserId)
}

export function deleteCustomLLMProvider(id: number, userId?: number | null): boolean {
  const scopedUserId = resolveRequiredUserId(userId)
  const info = getDb().prepare(`
    DELETE FROM custom_llm_providers
    WHERE id = ? AND user_id = ?
  `).run(id, scopedUserId)
  return info.changes > 0
}

export function listCustomLLMProviderUsage(id: number, userId?: number | null): Array<'chat' | 'summary' | 'translate'> {
  const scopedUserId = resolveRequiredUserId(userId)
  const rows = getDb().prepare(`
    SELECT key
    FROM user_settings
    WHERE user_id = ?
      AND key IN ('chat.provider_instance_id', 'summary.provider_instance_id', 'translate.provider_instance_id')
      AND value = ?
  `).all(scopedUserId, String(id)) as Array<{ key: string }>

  return rows.map(({ key }) => {
    if (key === 'chat.provider_instance_id') return 'chat'
    if (key === 'summary.provider_instance_id') return 'summary'
    return 'translate'
  })
}
