import { z } from 'zod'
import {
  getDb,
  upsertSetting,
  getSetting,
  createCustomLLMProvider,
  updateCustomLLMProvider,
  createNotificationChannel,
  updateNotificationChannel,
} from './db.js'
import { assertSafeUrl } from './fetcher/ssrf.js'
import { invalidateFetchScheduleConfigCache } from './fetcher/schedule.js'
import { invalidateArticleImageStoragePathCache } from './article-image-storage-path.js'
import { invalidateSocialRssHubBaseUrlCache } from './social-feeds.js'
import { isNotificationTimezone } from '../shared/notification-timezone.js'
import { getAllModelValues, getModelValues } from '../shared/models.js'

const INSTANCE_SETTING_KEYS = [
  'auth.password_enabled',
  'auth.github_enabled',
  'auth.github_client_id',
  'auth.github_client_secret',
  'auth.github_allowed_users',
  'system.feed_min_check_interval_minutes',
  'images.enabled',
  'images.storage',
  'images.storage_path',
  'images.max_size_mb',
  'images.upload_url',
  'images.upload_headers',
  'images.upload_field',
  'images.upload_resp_path',
  'images.healthcheck_url',
  'social.rsshub_base_url',
] as const

const USER_SETTING_KEYS = [
  'profile.account_name',
  'profile.avatar_seed',
  'general.language',
  'appearance.color_theme',
  'reading.date_mode',
  'reading.auto_mark_read',
  'reading.unread_indicator',
  'reading.internal_links',
  'reading.show_thumbnails',
  'reading.show_feed_activity',
  'reading.chat_position',
  'reading.article_open_mode',
  'reading.category_unread_only',
  'reading.keyboard_navigation',
  'reading.keybindings',
  'appearance.mascot',
  'appearance.highlight_theme',
  'appearance.font_family',
  'appearance.list_layout',
  'chat.provider',
  'chat.provider_instance_id',
  'chat.model',
  'summary.provider',
  'summary.provider_instance_id',
  'summary.model',
  'translate.provider',
  'translate.provider_instance_id',
  'translate.model',
  'translate.target_lang',
  'ollama.base_url',
  'ollama.custom_headers',
  'custom_themes',
  'retention.enabled',
  'retention.read_days',
  'retention.unread_days',
  'api_key.anthropic',
  'api_key.gemini',
  'api_key.openai',
  'api_key.google_translate',
  'api_key.deepl',
] as const

const NEVER_TRANSFER_SETTING_KEYS = new Set(['system.jwt_secret'])
const SECRET_SETTING_KEYS = new Set([
  'auth.github_client_secret',
  'images.upload_headers',
  'ollama.custom_headers',
  'api_key.anthropic',
  'api_key.gemini',
  'api_key.openai',
  'api_key.google_translate',
  'api_key.deepl',
])

const SettingEntry = z.object({
  key: z.string(),
  value: z.string(),
})

const CustomLlmProviderEntry = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1),
  kind: z.literal('openai-compatible'),
  base_url: z.string().trim().min(1),
  api_key: z.string().trim().min(1).nullable().optional(),
  secretRedacted: z.boolean().optional(),
})

const NotificationChannelEntry = z.object({
  id: z.number().int().positive().optional(),
  type: z.literal('feishu_webhook'),
  name: z.string().trim().min(1),
  webhook_url: z.string().trim().min(1).nullable().optional(),
  secret: z.string().nullable().optional(),
  timezone: z.string().optional(),
  enabled: z.coerce.number().int().min(0).max(1).optional(),
  secretRedacted: z.boolean().optional(),
})

export const SettingsTransferBundleSchema = z.object({
  app: z.literal('oksskolten'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  includeSecrets: z.boolean().optional(),
  scope: z.unknown().optional(),
  instanceSettings: z.array(SettingEntry).optional(),
  userSettings: z.array(SettingEntry).optional(),
  customLlmProviders: z.array(CustomLlmProviderEntry).optional(),
  notificationChannels: z.array(NotificationChannelEntry).optional(),
  excluded: z.array(z.unknown()).optional(),
})

type TransferSummary = {
  created: number
  updated: number
  skipped: number
}

export type SettingsTransferResult = {
  ok: boolean
  summary: Record<'instanceSettings' | 'userSettings' | 'customLlmProviders' | 'notificationChannels', TransferSummary>
  warnings: string[]
  errors: string[]
}

function emptySummary(): SettingsTransferResult['summary'] {
  return {
    instanceSettings: { created: 0, updated: 0, skipped: 0 },
    userSettings: { created: 0, updated: 0, skipped: 0 },
    customLlmProviders: { created: 0, updated: 0, skipped: 0 },
    notificationChannels: { created: 0, updated: 0, skipped: 0 },
  }
}

function resolveUserIdForTransfer(userId?: number | null): number {
  if (userId != null) return userId
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

function selectSettings(table: 'instance_settings' | 'user_settings', keys: readonly string[], userId?: number | null): Array<{ key: string; value: string }> {
  const placeholders = keys.map(() => '?').join(', ')
  if (table === 'user_settings') {
    if (userId != null) {
      return getDb().prepare(`
        SELECT key, value
        FROM user_settings
        WHERE user_id = ? AND key IN (${placeholders})
        ORDER BY key
      `).all(userId, ...keys) as Array<{ key: string; value: string }>
    } else {
      return getDb().prepare(`
        SELECT key, value
        FROM settings
        WHERE key IN (${placeholders})
        ORDER BY key
      `).all(...keys) as Array<{ key: string; value: string }>
    }
  }
  return getDb().prepare(`
    SELECT key, value
    FROM instance_settings
    WHERE key IN (${placeholders})
    ORDER BY key
  `).all(...keys) as Array<{ key: string; value: string }>
}

function exportSettingRows(rows: Array<{ key: string; value: string }>, includeSecrets: boolean) {
  return rows
    .filter(row => !NEVER_TRANSFER_SETTING_KEYS.has(row.key))
    .filter(row => includeSecrets || !SECRET_SETTING_KEYS.has(row.key))
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function buildSettingsExportBundle(userId: number | null, includeSecrets: boolean) {
  const resolvedUserId = resolveUserIdForTransfer(userId)

  const customProviders = getDb().prepare(`
    SELECT id, name, kind, base_url, api_key
    FROM custom_llm_providers
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(resolvedUserId) as Array<{ id: number; name: string; kind: 'openai-compatible'; base_url: string; api_key: string }>

  const channelScope = userId == null
    ? { clause: 'user_id IS NULL', params: [] }
    : { clause: 'user_id = ?', params: [userId] }

  const channels = getDb().prepare(`
    SELECT id, type, name, webhook_url, secret, timezone, enabled
    FROM notification_channels
    WHERE ${channelScope.clause}
    ORDER BY created_at DESC, id DESC
  `).all(...channelScope.params) as Array<{ id: number; type: 'feishu_webhook'; name: string; webhook_url: string; secret: string | null; timezone: string; enabled: number }>

  return {
    app: 'oksskolten',
    version: 1,
    exportedAt: new Date().toISOString(),
    includeSecrets,
    scope: { instance: true, user: 'current' },
    instanceSettings: exportSettingRows(selectSettings('instance_settings', INSTANCE_SETTING_KEYS), includeSecrets),
    userSettings: exportSettingRows(selectSettings('user_settings', USER_SETTING_KEYS, userId), includeSecrets),
    customLlmProviders: customProviders.map(provider => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      base_url: provider.base_url,
      api_key: includeSecrets ? provider.api_key : null,
      secretRedacted: !includeSecrets,
    })),
    notificationChannels: channels.map(channel => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      webhook_url: includeSecrets ? channel.webhook_url : null,
      secret: includeSecrets ? channel.secret : null,
      timezone: channel.timezone,
      enabled: channel.enabled,
      secretRedacted: !includeSecrets,
    })),
    excluded: [
      { type: 'setting', key: 'system.jwt_secret', reason: 'jwt_secret_never_exported' },
      { type: 'table', key: 'api_keys', reason: 'api_tokens_not_recoverable' },
      { type: 'table', key: 'credentials', reason: 'passkeys_not_portable' },
      { type: 'table', key: 'feed_notification_rules', reason: 'feed_bound_rules_out_of_scope' },
    ],
  }
}

function isAllowedInstanceKey(key: string): key is typeof INSTANCE_SETTING_KEYS[number] {
  return (INSTANCE_SETTING_KEYS as readonly string[]).includes(key)
}

function isAllowedUserKey(key: string): key is typeof USER_SETTING_KEYS[number] {
  return (USER_SETTING_KEYS as readonly string[]).includes(key)
}

function countSettingAction(existing: string | undefined, summary: TransferSummary): void {
  if (existing === undefined) summary.created += 1
  else summary.updated += 1
}

const PROVIDER_MODEL_PAIRS = [
  { providerKey: 'chat.provider', modelKey: 'chat.model' },
  { providerKey: 'summary.provider', modelKey: 'summary.model' },
  { providerKey: 'translate.provider', modelKey: 'translate.model' },
] as const

const PREF_ALLOWED: Record<string, string[] | null> = {
  'appearance.color_theme': null,
  'reading.date_mode': ['relative', 'absolute'],
  'reading.auto_mark_read': ['on', 'off'],
  'reading.unread_indicator': ['on', 'off'],
  'reading.internal_links': ['on', 'off'],
  'reading.show_thumbnails': ['on', 'off'],
  'reading.show_feed_activity': ['on', 'off'],
  'reading.chat_position': ['fab', 'inline'],
  'reading.article_open_mode': ['page', 'overlay'],
  'reading.category_unread_only': ['on', 'off'],
  'reading.keyboard_navigation': ['on', 'off'],
  'reading.keybindings': null,
  'appearance.mascot': ['off', 'dream-puff', 'sleepy-giant'],
  'appearance.highlight_theme': null,
  'appearance.font_family': null,
  'appearance.list_layout': ['list', 'card', 'magazine', 'compact'],
  'chat.provider': ['anthropic', 'gemini', 'openai', 'claude-code', 'ollama'],
  'chat.provider_instance_id': null,
  'chat.model': getAllModelValues(),
  'summary.provider': ['anthropic', 'gemini', 'openai', 'claude-code', 'ollama'],
  'summary.provider_instance_id': null,
  'summary.model': getAllModelValues(),
  'translate.provider': ['anthropic', 'gemini', 'openai', 'claude-code', 'ollama', 'google-translate', 'deepl'],
  'translate.provider_instance_id': null,
  'translate.model': getAllModelValues(),
  'translate.target_lang': ['ja', 'en', 'zh'],
  'ollama.base_url': null,
  'ollama.custom_headers': null,
  'custom_themes': null,
  'retention.enabled': ['on', 'off'],
  'retention.read_days': null,
  'retention.unread_days': null,
}

async function validateInstanceSetting(key: string, value: string): Promise<string | null> {
  if (key === 'social.rsshub_base_url') {
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'https:') return 'social.rsshub_base_url must use https'
    } catch {
      return 'social.rsshub_base_url must be a valid URL'
    }
  }
  if (key === 'images.upload_url' || key === 'images.healthcheck_url') {
    try {
      await assertSafeUrl(value)
    } catch {
      return `${key} is invalid or blocked`
    }
  }
  if (key === 'images.upload_headers') {
    try {
      JSON.parse(value)
    } catch {
      return `${key} must be valid JSON`
    }
  }
  if (key === 'system.feed_min_check_interval_minutes') {
    const num = Number(value)
    if (!Number.isInteger(num) || num < 1 || num > 240) return `${key} must be 1-240`
  }
  if (key === 'images.max_size_mb') {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0 || num > 100) return `${key} must be 1-100`
  }
  if (key === 'images.storage') {
    if (value !== 'local' && value !== 'remote') return 'images.storage must be "local" or "remote"'
  }
  if (key === 'images.enabled' || key === 'auth.password_enabled' || key === 'auth.github_enabled') {
    if (!['0', '1', 'true', 'false'].includes(value)) return `${key} must be a boolean value ("0", "1", "true", "false")`
  }
  return null
}

async function validateUserSetting(
  key: string,
  value: string,
  userSettingsMap: Map<string, string>,
  userId: number | null
): Promise<string | null> {
  if (key === 'reading.keybindings' || key === 'custom_themes' || key === 'ollama.custom_headers') {
    try {
      JSON.parse(value)
    } catch {
      return `${key} must be valid JSON`
    }
  }
  if (key === 'chat.provider_instance_id' || key === 'summary.provider_instance_id' || key === 'translate.provider_instance_id') {
    const num = Number(value)
    if (!Number.isInteger(num) || num <= 0) {
      return `${key} must be a positive integer`
    }
  }
  if (key === 'retention.read_days' || key === 'retention.unread_days') {
    const num = Number(value)
    if (!Number.isInteger(num) || num < 1 || num > 9999) {
      return `${key} must be a positive integer (1-9999)`
    }
  }
  if (key === 'general.language' && !['ja', 'en', 'zh'].includes(value)) {
    return `${key} is invalid`
  }

  if (Object.prototype.hasOwnProperty.call(PREF_ALLOWED, key)) {
    const allowed = PREF_ALLOWED[key]
    if (allowed) {
      if (!allowed.includes(value)) {
        const modelKeyPair = PROVIDER_MODEL_PAIRS.find(p => p.modelKey === key)
        if (modelKeyPair) {
          const provider = userSettingsMap.get(modelKeyPair.providerKey) ?? getSetting(modelKeyPair.providerKey, userId)
          if (provider === 'ollama' || provider === 'openai') {
            return null
          }
        }
        return `Invalid value for ${key}`
      }
    }
  }
  return null
}

const PROVIDER_INSTANCE_PAIRS = [
  { providerKey: 'chat.provider', providerInstanceKey: 'chat.provider_instance_id' },
  { providerKey: 'summary.provider', providerInstanceKey: 'summary.provider_instance_id' },
  { providerKey: 'translate.provider', providerInstanceKey: 'translate.provider_instance_id' },
] as const

async function validateBundle(bundle: z.infer<typeof SettingsTransferBundleSchema>, userId: number | null): Promise<string[]> {
  const errors: string[] = []
  const userSettingsMap = new Map(bundle.userSettings?.map(entry => [entry.key, entry.value]) ?? [])

  const getMergedSetting = (key: string): string | undefined => {
    return userSettingsMap.get(key) ?? getSetting(key, userId)
  }

  for (const entry of bundle.instanceSettings ?? []) {
    if (NEVER_TRANSFER_SETTING_KEYS.has(entry.key)) continue
    if (!isAllowedInstanceKey(entry.key)) continue
    const error = await validateInstanceSetting(entry.key, entry.value)
    if (error) errors.push(error)
  }
  for (const entry of bundle.userSettings ?? []) {
    if (!isAllowedUserKey(entry.key)) continue
    const error = await validateUserSetting(entry.key, entry.value, userSettingsMap, userId)
    if (error) errors.push(error)
  }

  // Cross-field validation: provider_instance_id must only be set when provider is openai
  for (const { providerKey, providerInstanceKey } of PROVIDER_INSTANCE_PAIRS) {
    const instanceId = getMergedSetting(providerInstanceKey)
    if (instanceId !== undefined && instanceId.trim() !== '') {
      const provider = getMergedSetting(providerKey)
      if (provider !== 'openai') {
        errors.push(`Custom provider instance ID can only be set when provider is openai`)
      }
    }
  }

  // Cross-field validation: model compatibility for each provider
  for (const { providerKey, modelKey } of PROVIDER_MODEL_PAIRS) {
    const model = getMergedSetting(modelKey)
    const provider = getMergedSetting(providerKey)
    if (model && provider) {
      if (provider !== 'google-translate' && provider !== 'deepl' && provider !== 'ollama' && provider !== 'openai') {
        const effectiveProvider = provider === 'claude-code' ? 'anthropic' : provider
        const allowedModels = getModelValues(effectiveProvider)
        if (allowedModels.length > 0 && !allowedModels.includes(model)) {
          errors.push(`Model ${model} is not valid for provider ${provider}`)
        }
      }
    }
  }

  for (const provider of bundle.customLlmProviders ?? []) {
    try {
      const parsed = new URL(provider.base_url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') errors.push(`Invalid custom LLM provider URL: ${provider.name}`)
    } catch {
      errors.push(`Invalid custom LLM provider URL: ${provider.name}`)
    }
  }
  for (const channel of bundle.notificationChannels ?? []) {
    if (channel.webhook_url) {
      try {
        const parsed = new URL(channel.webhook_url)
        if (parsed.protocol !== 'https:') errors.push(`Invalid notification webhook URL: ${channel.name}`)
      } catch {
        errors.push(`Invalid notification webhook URL: ${channel.name}`)
      }
    }
  }
  return errors
}

function findExistingProvider(userId: number, name: string, baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl)
  const rows = getDb().prepare(`
    SELECT id, name, kind, base_url, api_key
    FROM custom_llm_providers
    WHERE user_id = ? AND kind = 'openai-compatible' AND name = ?
  `).all(userId, name) as Array<{ id: number; name: string; kind: 'openai-compatible'; base_url: string; api_key: string }>
  return rows.find(p => normalizeBaseUrl(p.base_url) === normalized)
}

function findExistingChannel(userId: number | null, type: string, name: string) {
  const scope = userId == null
    ? { clause: 'user_id IS NULL', params: [] }
    : { clause: 'user_id = ?', params: [userId] }
  return getDb().prepare(`
    SELECT id, type, name, webhook_url, secret, timezone, enabled
    FROM notification_channels
    WHERE type = ? AND name = ? AND ${scope.clause}
  `).get(type, name, ...scope.params) as { id: number; type: 'feishu_webhook'; name: string; webhook_url: string; secret: string | null; timezone: string; enabled: number } | undefined
}

export async function previewSettingsImport(input: unknown, userId: number | null): Promise<SettingsTransferResult> {
  const parsed = SettingsTransferBundleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, summary: emptySummary(), warnings: [], errors: parsed.error.issues.map(issue => issue.message) }
  }
  const errors = await validateBundle(parsed.data, userId)
  if (errors.length > 0) return { ok: false, summary: emptySummary(), warnings: [], errors }

  const summary = emptySummary()
  const warnings: string[] = []
  const resolvedUserId = resolveUserIdForTransfer(userId)

  for (const entry of parsed.data.instanceSettings ?? []) {
    if (NEVER_TRANSFER_SETTING_KEYS.has(entry.key)) {
      summary.instanceSettings.skipped += 1
      warnings.push(`Skipped ${entry.key}`)
      continue
    }
    if (!isAllowedInstanceKey(entry.key)) {
      summary.instanceSettings.skipped += 1
      warnings.push(`Skipped unknown instance setting ${entry.key}`)
      continue
    }
    const existing = getDb().prepare('SELECT value FROM instance_settings WHERE key = ?').get(entry.key) as { value: string } | undefined
    countSettingAction(existing?.value, summary.instanceSettings)
  }
  for (const entry of parsed.data.userSettings ?? []) {
    if (!isAllowedUserKey(entry.key)) {
      summary.userSettings.skipped += 1
      warnings.push(`Skipped unknown user setting ${entry.key}`)
      continue
    }
    const existing = getDb().prepare(
      userId != null
        ? 'SELECT value FROM user_settings WHERE user_id = ? AND key = ?'
        : 'SELECT value FROM settings WHERE key = ?'
    ).get(
      ...(userId != null ? [userId, entry.key] : [entry.key])
    ) as { value: string } | undefined
    countSettingAction(existing?.value, summary.userSettings)
  }
  for (const provider of parsed.data.customLlmProviders ?? []) {
    const existing = findExistingProvider(resolvedUserId, provider.name, provider.base_url)
    if (!existing && !provider.api_key) {
      summary.customLlmProviders.skipped += 1
      warnings.push(`Skipped custom LLM provider ${provider.name} because api_key was redacted`)
    } else if (existing) summary.customLlmProviders.updated += 1
    else summary.customLlmProviders.created += 1
  }
  for (const channel of parsed.data.notificationChannels ?? []) {
    const existing = findExistingChannel(userId, channel.type, channel.name)
    if (!existing && !channel.webhook_url) {
      summary.notificationChannels.skipped += 1
      warnings.push(`Skipped notification channel ${channel.name} because webhook_url was redacted`)
    } else if (existing) summary.notificationChannels.updated += 1
    else summary.notificationChannels.created += 1
  }
  return { ok: true, summary, warnings, errors: [] }
}

export async function importSettingsBundle(input: unknown, userId: number | null): Promise<SettingsTransferResult> {
  const parsed = SettingsTransferBundleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, summary: emptySummary(), warnings: [], errors: parsed.error.issues.map(issue => issue.message) }
  }
  const errors = await validateBundle(parsed.data, userId)
  if (errors.length > 0) return { ok: false, summary: emptySummary(), warnings: [], errors }

  const summary = emptySummary()
  const warnings: string[] = []
  const resolvedUserId = resolveUserIdForTransfer(userId)

  try {
    getDb().transaction(() => {
      // 1. 导入 Instance Settings
      for (const entry of parsed.data.instanceSettings ?? []) {
        if (NEVER_TRANSFER_SETTING_KEYS.has(entry.key)) {
          summary.instanceSettings.skipped += 1
          warnings.push(`Skipped ${entry.key}`)
          continue
        }
        if (!isAllowedInstanceKey(entry.key)) {
          summary.instanceSettings.skipped += 1
          warnings.push(`Skipped unknown instance setting ${entry.key}`)
          continue
        }
        const existing = getDb().prepare('SELECT value FROM instance_settings WHERE key = ?').get(entry.key) as { value: string } | undefined
        countSettingAction(existing?.value, summary.instanceSettings)
        upsertSetting(entry.key, entry.value)
      }

      // 2. 导入 Custom LLM Providers 并建立 id 映射
      const providerIdMap = new Map<string, string>()
      for (const provider of parsed.data.customLlmProviders ?? []) {
        const existing = findExistingProvider(resolvedUserId, provider.name, provider.base_url)
        if (existing) {
          const updateData: any = {
            name: provider.name,
            base_url: provider.base_url,
          }
          if (provider.api_key && provider.api_key.trim() !== '') {
            updateData.api_key = provider.api_key.trim()
          }
          const updated = updateCustomLLMProvider(existing.id, updateData, resolvedUserId)
          if (updated) {
            summary.customLlmProviders.updated += 1
            if (provider.id != null) {
              providerIdMap.set(String(provider.id), String(updated.id))
            }
          } else {
            summary.customLlmProviders.skipped += 1
            warnings.push(`Failed to update Custom LLM Provider ${provider.name}`)
          }
        } else {
          if (provider.api_key && provider.api_key.trim() !== '') {
            const created = createCustomLLMProvider({
              name: provider.name,
              base_url: provider.base_url,
              api_key: provider.api_key.trim(),
            }, resolvedUserId)
            summary.customLlmProviders.created += 1
            if (provider.id != null) {
              providerIdMap.set(String(provider.id), String(created.id))
            }
          } else {
            summary.customLlmProviders.skipped += 1
            warnings.push(`Skipped custom LLM provider ${provider.name} because api_key was redacted`)
          }
        }
      }

      // 3. 导入 User Settings (除 provider_instance_id 之外的)
      const instanceIdKeys = new Set(['chat.provider_instance_id', 'summary.provider_instance_id', 'translate.provider_instance_id'])
      for (const entry of parsed.data.userSettings ?? []) {
        if (!isAllowedUserKey(entry.key)) {
          summary.userSettings.skipped += 1
          warnings.push(`Skipped unknown user setting ${entry.key}`)
          continue
        }
        if (instanceIdKeys.has(entry.key)) {
          continue
        }
        const existing = getDb().prepare(
          userId != null
            ? 'SELECT value FROM user_settings WHERE user_id = ? AND key = ?'
            : 'SELECT value FROM settings WHERE key = ?'
        ).get(
          ...(userId != null ? [userId, entry.key] : [entry.key])
        ) as { value: string } | undefined
        countSettingAction(existing?.value, summary.userSettings)
        upsertSetting(entry.key, entry.value, userId)
      }

      // 处理 provider_instance_id 映射并写入
      for (const key of ['chat.provider_instance_id', 'summary.provider_instance_id', 'translate.provider_instance_id'] as const) {
        const entry = parsed.data.userSettings?.find(e => e.key === key)
        if (!entry) continue

        const importedVal = entry.value
        if (importedVal && importedVal.trim() !== '') {
          const localVal = providerIdMap.get(importedVal.trim())
          if (localVal) {
            const existing = getDb().prepare(
              userId != null
                ? 'SELECT value FROM user_settings WHERE user_id = ? AND key = ?'
                : 'SELECT value FROM settings WHERE key = ?'
            ).get(
              ...(userId != null ? [userId, key] : [key])
            ) as { value: string } | undefined
            countSettingAction(existing?.value, summary.userSettings)
            upsertSetting(key, localVal, userId)
          } else {
            summary.userSettings.skipped += 1
            warnings.push(`Skipped user setting ${key} because imported provider id ${importedVal} could not be mapped`)
          }
        }
      }

      // 4. 导入 Notification Channels
      for (const channel of parsed.data.notificationChannels ?? []) {
        const existing = findExistingChannel(userId, channel.type, channel.name)
        if (existing) {
          const updateData: any = {
            name: channel.name,
            timezone: channel.timezone,
            enabled: channel.enabled,
          }
          if (channel.webhook_url && channel.webhook_url.trim() !== '') {
            updateData.webhook_url = channel.webhook_url.trim()
          }
          if (channel.secret !== undefined && channel.secret !== null) {
            updateData.secret = channel.secret
          }
          const updated = updateNotificationChannel(existing.id, updateData, userId)
          if (updated) {
            summary.notificationChannels.updated += 1
          } else {
            summary.notificationChannels.skipped += 1
            warnings.push(`Failed to update notification channel ${channel.name}`)
          }
        } else {
          if (channel.webhook_url && channel.webhook_url.trim() !== '') {
            createNotificationChannel({
              type: channel.type,
              name: channel.name,
              webhook_url: channel.webhook_url.trim(),
              secret: channel.secret ?? null,
              timezone: (channel.timezone && isNotificationTimezone(channel.timezone)) ? channel.timezone : undefined,
              enabled: channel.enabled ?? 1,
            }, userId)
            summary.notificationChannels.created += 1
          } else {
            summary.notificationChannels.skipped += 1
            warnings.push(`Skipped notification channel ${channel.name} because webhook_url was redacted`)
          }
        }
      }
    })()
  } catch (err) {
    return {
      ok: false,
      summary: emptySummary(),
      warnings: [],
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  // 5. 缓存失效化
  try {
    invalidateFetchScheduleConfigCache()
    invalidateArticleImageStoragePathCache()
    invalidateSocialRssHubBaseUrlCache()
  } catch (e) {
    // ignore
  }

  return { ok: true, summary, warnings, errors: [] }
}
