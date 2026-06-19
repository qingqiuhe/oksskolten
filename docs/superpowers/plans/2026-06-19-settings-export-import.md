# Settings Export And Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build owner/admin settings export and import for recoverable Oksskolten platform configuration, with safe default redaction and optional secret inclusion.

**Architecture:** Add a focused backend transfer module for bundle schema, export, preview, validation, and transactional import. Register small settings routes that call the module. Add a Settings -> Data frontend section that downloads JSON, previews JSON imports, and confirms import.

**Tech Stack:** Node.js 22, Fastify, libsql SQLite, zod, React 19, SWR, Vitest, Testing Library.

---

## File Map

- Create: `server/settings-transfer.ts`  
  Owns bundle types, allowlisted keys, secret/exclusion rules, export building, preview, validation, and transactional import.
- Modify: `server/routes/settings.ts`  
  Registers `GET /api/settings/export`, `POST /api/settings/import/preview`, and `POST /api/settings/import`.
- Test: `server/routes/settings-transfer.test.ts`  
  Covers redaction, admin gating, exclusions, dry-run behavior, import atomicity, provider id remapping, and notification channel import.
- Create: `src/pages/settings/sections/settings-transfer-section.tsx`  
  Adds Data tab UI for export/import settings.
- Test: `src/pages/settings/sections/settings-transfer-section.test.tsx`  
  Covers export call, secret toggle, JSON file preview, confirm import, and error display.
- Modify: `src/pages/settings/data-tab.tsx`  
  Renders the new settings transfer section near OPML feed migration.
- Modify: `src/lib/fetcher.ts`  
  Adds typed helpers for settings export/import.
- Modify: `src/lib/fetcher.demo.ts`  
  Adds no-op/demo-compatible helpers so demo mode continues to build.
- Modify: `src/lib/i18n.ts`  
  Adds concise labels/messages in English, Japanese, and Simplified Chinese.

## Task 1: Backend Transfer Module Tests

**Files:**
- Create: `server/routes/settings-transfer.test.ts`

- [ ] **Step 1: Add backend tests for export redaction and exclusions**

Create `server/routes/settings-transfer.test.ts` with the shared setup pattern from `server/routes/settings.test.ts`. Include tests with these exact behaviors:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import {
  createCustomLLMProvider,
  createNotificationChannel,
  getDb,
  getSetting,
  upsertSetting,
} from '../db.js'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { invalidateSocialRssHubBaseUrlCache } from '../social-feeds.js'

vi.mock('../fetcher.js', async () => {
  const { EventEmitter } = await import('events')
  return {
    fetchAllFeeds: vi.fn(),
    fetchSingleFeed: vi.fn(),
    discoverRssUrl: vi.fn().mockResolvedValue({ rssUrl: null, title: null }),
    summarizeArticle: vi.fn(),
    streamSummarizeArticle: vi.fn(),
    translateArticle: vi.fn(),
    streamTranslateArticle: vi.fn(),
    fetchProgress: new EventEmitter(),
    getFeedState: vi.fn(),
  }
})

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

function createAuthedUser(role: 'owner' | 'admin' | 'member') {
  const email = `${role}-${Math.random().toString(36).slice(2)}@example.com`
  const info = getDb().prepare(`
    INSERT INTO users (email, password_hash, role, status)
    VALUES (?, ?, ?, 'active')
  `).run(email, hashSync('password123', 4), role)
  const userId = Number(info.lastInsertRowid)
  return {
    userId,
    headers: {
      authorization: `Bearer ${app.jwt.sign({
        sub: userId,
        email,
        role,
        token_version: 0,
      })}`,
    },
  }
}

beforeEach(async () => {
  setupTestDb()
  invalidateSocialRssHubBaseUrlCache()
  app = await buildApp()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settings transfer export', () => {
  it('redacts secrets by default and always excludes non-portable auth artifacts', async () => {
    const owner = createAuthedUser('owner')
    upsertSetting('api_key.openai', 'sk-openai-secret', owner.userId)
    upsertSetting('auth.github_client_secret', 'github-secret')
    upsertSetting('system.jwt_secret', 'jwt-secret')
    createCustomLLMProvider({
      name: 'DeepSeek',
      base_url: 'https://api.deepseek.com',
      api_key: 'deepseek-secret',
    }, owner.userId)
    createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Team',
      webhook_url: 'https://open.feishu.cn/webhook/abc',
      secret: 'notify-secret',
      enabled: 1,
    }, owner.userId)

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/export',
      headers: owner.headers,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body).not.toContain('sk-openai-secret')
    expect(res.body).not.toContain('github-secret')
    expect(res.body).not.toContain('jwt-secret')
    expect(res.body).not.toContain('deepseek-secret')
    expect(res.body).not.toContain('notify-secret')
    const body = res.json()
    expect(body.includeSecrets).toBe(false)
    expect(body.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'system.jwt_secret' }),
      expect.objectContaining({ key: 'api_keys' }),
      expect.objectContaining({ key: 'credentials' }),
      expect.objectContaining({ key: 'feed_notification_rules' }),
    ]))
  })

  it('includes recoverable secrets only when explicitly requested by an owner/admin', async () => {
    const owner = createAuthedUser('owner')
    upsertSetting('api_key.openai', 'sk-openai-secret', owner.userId)
    upsertSetting('auth.github_client_secret', 'github-secret')
    upsertSetting('system.jwt_secret', 'jwt-secret')

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/export?includeSecrets=1',
      headers: owner.headers,
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('sk-openai-secret')
    expect(res.body).toContain('github-secret')
    expect(res.body).not.toContain('jwt-secret')
    expect(res.json().includeSecrets).toBe(true)
  })

  it('forbids members from settings transfer endpoints', async () => {
    const member = createAuthedUser('member')
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/settings/export',
      headers: member.headers,
    })
    const previewRes = await app.inject({
      method: 'POST',
      url: '/api/settings/import/preview',
      headers: { ...member.headers, ...json },
      payload: { app: 'oksskolten', version: 1 },
    })
    expect(exportRes.statusCode).toBe(403)
    expect(previewRes.statusCode).toBe(403)
  })
})
```

- [ ] **Step 2: Add backend tests for preview and import**

Append tests for import dry-run, provider remapping, and never importing `system.jwt_secret`:

```ts
describe('settings transfer import', () => {
  it('previews without writing settings', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      includeSecrets: false,
      instanceSettings: [{ key: 'social.rsshub_base_url', value: 'https://rsshub.example.com' }],
      userSettings: [{ key: 'appearance.color_theme', value: 'nord' }],
      customLlmProviders: [],
      notificationChannels: [],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import/preview',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(getSetting('social.rsshub_base_url')).toBeUndefined()
    expect(getSetting('appearance.color_theme', owner.userId)).toBeUndefined()
  })

  it('imports supported settings atomically and remaps custom provider ids', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      includeSecrets: true,
      instanceSettings: [
        { key: 'social.rsshub_base_url', value: 'https://rsshub.example.com' },
        { key: 'system.jwt_secret', value: 'imported-jwt-secret' },
      ],
      userSettings: [
        { key: 'chat.provider', value: 'openai' },
        { key: 'chat.provider_instance_id', value: '77' },
        { key: 'chat.model', value: 'deepseek-chat' },
      ],
      customLlmProviders: [{
        id: 77,
        name: 'DeepSeek',
        kind: 'openai-compatible',
        base_url: 'https://api.deepseek.com',
        api_key: 'deepseek-secret',
      }],
      notificationChannels: [{
        id: 88,
        type: 'feishu_webhook',
        name: 'Team',
        webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
        secret: 'notify-secret',
        timezone: 'UTC+8',
        enabled: 1,
      }],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(getSetting('social.rsshub_base_url')).toBe('https://rsshub.example.com')
    expect(getSetting('system.jwt_secret')).toBeUndefined()
    const localProviderId = getSetting('chat.provider_instance_id', owner.userId)
    expect(localProviderId).toMatch(/^\d+$/)
    expect(localProviderId).not.toBe('77')
    const provider = getDb().prepare('SELECT * FROM custom_llm_providers WHERE id = ?').get(Number(localProviderId)) as { api_key: string; base_url: string }
    expect(provider.api_key).toBe('deepseek-secret')
    expect(provider.base_url).toBe('https://api.deepseek.com')
  })

  it('rejects invalid bundles without partial writes', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      instanceSettings: [{ key: 'social.rsshub_base_url', value: 'not-a-url' }],
      userSettings: [{ key: 'appearance.color_theme', value: 'nord' }],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('social.rsshub_base_url')).toBeUndefined()
    expect(getSetting('appearance.color_theme', owner.userId)).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the new test and confirm it fails**

Run:

```bash
npm test -- server/routes/settings-transfer.test.ts
```

Expected: FAIL because the new transfer routes do not exist yet.

## Task 2: Backend Transfer Implementation

**Files:**
- Create: `server/settings-transfer.ts`
- Modify: `server/routes/settings.ts`

- [ ] **Step 1: Implement bundle schema and allowlists**

Create `server/settings-transfer.ts`. Include:

```ts
import { z } from 'zod'
import { getDb, upsertSetting } from './db.js'
import { assertSafeUrl } from './fetcher/ssrf.js'
import { invalidateFetchScheduleConfigCache } from './fetcher/schedule.js'
import { invalidateArticleImageStoragePathCache } from './article-image-storage-path.js'
import { invalidateSocialRssHubBaseUrlCache } from './social-feeds.js'

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
```

If TypeScript complains about readonly tuple to Set typing, cast the arrays to `readonly string[]` where needed. Keep the allowlists local to this module for now; do not refactor existing settings route constants in this task.

- [ ] **Step 2: Implement export helpers**

In `server/settings-transfer.ts`, add helper functions:

```ts
type SettingKey = typeof INSTANCE_SETTING_KEYS[number] | typeof USER_SETTING_KEYS[number]

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

function selectSettings(table: 'instance_settings' | 'user_settings', keys: readonly string[], userId?: number): Array<{ key: string; value: string }> {
  const placeholders = keys.map(() => '?').join(', ')
  if (table === 'user_settings') {
    return getDb().prepare(`
      SELECT key, value
      FROM user_settings
      WHERE user_id = ? AND key IN (${placeholders})
      ORDER BY key
    `).all(userId, ...keys) as Array<{ key: string; value: string }>
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

export function buildSettingsExportBundle(userId: number, includeSecrets: boolean) {
  const customProviders = getDb().prepare(`
    SELECT id, name, kind, base_url, api_key
    FROM custom_llm_providers
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId) as Array<{ id: number; name: string; kind: 'openai-compatible'; base_url: string; api_key: string }>

  const channels = getDb().prepare(`
    SELECT id, type, name, webhook_url, secret, timezone, enabled
    FROM notification_channels
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId) as Array<{ id: number; type: 'feishu_webhook'; name: string; webhook_url: string; secret: string | null; timezone: string; enabled: number }>

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
```

- [ ] **Step 3: Implement validation and preview/import**

Add validation helpers and the public preview/import functions:

```ts
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

async function validateSetting(key: string, value: string): Promise<string | null> {
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
  if (key === 'images.upload_headers' || key === 'ollama.custom_headers' || key === 'reading.keybindings' || key === 'custom_themes') {
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
  if (key === 'general.language' && !['ja', 'en', 'zh'].includes(value)) return `${key} is invalid`
  return null
}

async function validateBundle(bundle: z.infer<typeof SettingsTransferBundleSchema>): Promise<string[]> {
  const errors: string[] = []
  for (const entry of bundle.instanceSettings ?? []) {
    if (NEVER_TRANSFER_SETTING_KEYS.has(entry.key)) continue
    if (!isAllowedInstanceKey(entry.key)) continue
    const error = await validateSetting(entry.key, entry.value)
    if (error) errors.push(error)
  }
  for (const entry of bundle.userSettings ?? []) {
    if (!isAllowedUserKey(entry.key)) continue
    const error = await validateSetting(entry.key, entry.value)
    if (error) errors.push(error)
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
```

Then implement preview/import. Keep mutations in one transaction for formal import. If `db.transaction` typing is awkward with async validation, run all async validation before opening the transaction.

```ts
export async function previewSettingsImport(input: unknown, userId: number): Promise<SettingsTransferResult> {
  const parsed = SettingsTransferBundleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, summary: emptySummary(), warnings: [], errors: parsed.error.issues.map(issue => issue.message) }
  }
  const errors = await validateBundle(parsed.data)
  if (errors.length > 0) return { ok: false, summary: emptySummary(), warnings: [], errors }

  const summary = emptySummary()
  const warnings: string[] = []

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
    const existing = getDb().prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, entry.key) as { value: string } | undefined
    countSettingAction(existing?.value, summary.userSettings)
  }
  for (const provider of parsed.data.customLlmProviders ?? []) {
    const existing = findExistingProvider(userId, provider.name, provider.base_url)
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
```

Implement `findExistingProvider`, `findExistingChannel`, and `importSettingsBundle`. For `chat.provider_instance_id`, `summary.provider_instance_id`, and `translate.provider_instance_id`, only save the setting after provider import has built an imported-id to local-id map. Use `upsertSetting(key, value, userId)` for final setting writes.

- [ ] **Step 4: Register routes**

In `server/routes/settings.ts`, import the transfer functions:

```ts
import {
  buildSettingsExportBundle,
  importSettingsBundle,
  previewSettingsImport,
} from '../settings-transfer.js'
```

Inside `settingsRoutes`, add owner/admin routes near the other Settings endpoints:

```ts
  api.get('/api/settings/export', {
    preHandler: [requireRoles(['owner', 'admin'])],
  }, async (request, reply) => {
    const userId = getRequestUserId(request)
    if (userId == null) {
      reply.status(400).send({ error: 'User context is required' })
      return
    }
    const includeSecrets = request.query && typeof request.query === 'object' && 'includeSecrets' in request.query
      ? ['1', 'true', 'yes'].includes(String((request.query as Record<string, unknown>).includeSecrets))
      : false
    const bundle = buildSettingsExportBundle(userId, includeSecrets)
    const date = new Date().toISOString().slice(0, 10)
    reply.header('Content-Disposition', `attachment; filename="oksskolten-settings-${date}.json"`)
    reply.send(bundle)
  })

  api.post('/api/settings/import/preview', {
    preHandler: [requireJson, requireRoles(['owner', 'admin'])],
  }, async (request, reply) => {
    const userId = getRequestUserId(request)
    if (userId == null) {
      reply.status(400).send({ error: 'User context is required' })
      return
    }
    const result = await previewSettingsImport(request.body, userId)
    if (!result.ok) {
      reply.status(400).send(result)
      return
    }
    reply.send(result)
  })

  api.post('/api/settings/import', {
    preHandler: [requireJson, requireRoles(['owner', 'admin'])],
  }, async (request, reply) => {
    const userId = getRequestUserId(request)
    if (userId == null) {
      reply.status(400).send({ error: 'User context is required' })
      return
    }
    const result = await importSettingsBundle(request.body, userId)
    if (!result.ok) {
      reply.status(400).send(result)
      return
    }
    reply.send(result)
  })
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
npm test -- server/routes/settings-transfer.test.ts
```

Expected: PASS.

## Task 3: Frontend Fetcher And Data Tab UI

**Files:**
- Modify: `src/lib/fetcher.ts`
- Modify: `src/lib/fetcher.demo.ts`
- Create: `src/pages/settings/sections/settings-transfer-section.tsx`
- Modify: `src/pages/settings/data-tab.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add fetcher helpers**

In `src/lib/fetcher.ts`, add:

```ts
export type SettingsTransferSummary = Record<
  'instanceSettings' | 'userSettings' | 'customLlmProviders' | 'notificationChannels',
  { created: number; updated: number; skipped: number }
>

export type SettingsTransferResult = {
  ok: boolean
  summary: SettingsTransferSummary
  warnings: string[]
  errors: string[]
}

export async function fetchSettingsExportBlob(includeSecrets: boolean): Promise<Blob> {
  const query = includeSecrets ? '?includeSecrets=1' : ''
  const res = await fetch(`/api/settings/export${query}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok) return handleResponseError(res, '/api/settings/export')
  return res.blob()
}

export async function previewSettingsImport(bundle: unknown): Promise<SettingsTransferResult> {
  return apiPost('/api/settings/import/preview', bundle) as Promise<SettingsTransferResult>
}

export async function importSettingsBundle(bundle: unknown): Promise<SettingsTransferResult> {
  return apiPost('/api/settings/import', bundle) as Promise<SettingsTransferResult>
}
```

In `src/lib/fetcher.demo.ts`, export demo-compatible helpers with the same names:

```ts
export async function fetchSettingsExportBlob(): Promise<Blob> {
  return new Blob([JSON.stringify({ app: 'oksskolten', version: 1, includeSecrets: false }, null, 2)], { type: 'application/json' })
}

export async function previewSettingsImport(): Promise<import('./fetcher').SettingsTransferResult> {
  return {
    ok: true,
    summary: {
      instanceSettings: { created: 0, updated: 0, skipped: 0 },
      userSettings: { created: 0, updated: 0, skipped: 0 },
      customLlmProviders: { created: 0, updated: 0, skipped: 0 },
      notificationChannels: { created: 0, updated: 0, skipped: 0 },
    },
    warnings: [],
    errors: [],
  }
}

export const importSettingsBundle = previewSettingsImport
```

- [ ] **Step 2: Add i18n keys**

Add compact keys in `src/lib/i18n.ts` near the Data section:

```ts
'settings.settingsTransfer': { ja: '設定の移行', en: 'Settings Transfer' },
'settings.settingsTransferDesc': { ja: '設定を JSON としてエクスポートまたはインポート', en: 'Export or import settings as JSON' },
'settings.exportSettings': { ja: '設定をエクスポート', en: 'Export Settings' },
'settings.importSettings': { ja: '設定をインポート', en: 'Import Settings' },
'settings.includeSensitiveSettings': { ja: '機密設定を含める', en: 'Include sensitive configuration' },
'settings.settingsImportPreview': { ja: 'インポート内容', en: 'Import Preview' },
'settings.settingsImportConfirm': { ja: 'インポートを実行', en: 'Import Settings' },
'settings.settingsImportSuccess': { ja: '設定をインポートしました', en: 'Settings imported' },
'settings.settingsImportFailed': { ja: '設定のインポートに失敗しました', en: 'Settings import failed' },
'settings.settingsExportFailed': { ja: '設定のエクスポートに失敗しました', en: 'Settings export failed' },
'settings.settingsImportSummary': { ja: '作成 {created} / 更新 {updated} / スキップ {skipped}', en: '{created} created / {updated} updated / {skipped} skipped' },
```

Also add Simplified Chinese translations in the `zhMessages` block:

```ts
'settings.settingsTransfer': '设置迁移',
'settings.settingsTransferDesc': '以 JSON 导出或导入设置',
'settings.exportSettings': '导出设置',
'settings.importSettings': '导入设置',
'settings.includeSensitiveSettings': '包含敏感配置',
'settings.settingsImportPreview': '导入预览',
'settings.settingsImportConfirm': '导入设置',
'settings.settingsImportSuccess': '设置已导入',
'settings.settingsImportFailed': '设置导入失败',
'settings.settingsExportFailed': '设置导出失败',
'settings.settingsImportSummary': '创建 {created} / 更新 {updated} / 跳过 {skipped}',
```

- [ ] **Step 3: Create SettingsTransferSection**

Create `src/pages/settings/sections/settings-transfer-section.tsx`:

```tsx
import { useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { Download, Upload } from 'lucide-react'
import { useI18n } from '../../../lib/i18n'
import {
  fetchSettingsExportBlob,
  importSettingsBundle,
  previewSettingsImport,
  type SettingsTransferResult,
} from '../../../lib/fetcher'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog'

const SUMMARY_KEYS = ['instanceSettings', 'userSettings', 'customLlmProviders', 'notificationChannels'] as const

export function SettingsTransferSection() {
  const { t } = useI18n()
  const { mutate: globalMutate } = useSWRConfig()
  const fileRef = useRef<HTMLInputElement>(null)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [bundle, setBundle] = useState<unknown>(null)
  const [preview, setPreview] = useState<SettingsTransferResult | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setBusy(true)
    setError(null)
    try {
      const blob = await fetchSettingsExportBlob(includeSecrets)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `oksskolten-settings-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.settingsExportFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const result = await previewSettingsImport(parsed)
      setBundle(parsed)
      setPreview(result)
      setIsPreviewOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.settingsImportFailed'))
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  async function handleImport() {
    if (!bundle) return
    setBusy(true)
    setError(null)
    try {
      await importSettingsBundle(bundle)
      setMessage(t('settings.settingsImportSuccess'))
      setIsPreviewOpen(false)
      void globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/settings'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.settingsImportFailed'))
    } finally {
      setBusy(false)
    }
  }

  function formatSummary(result: SettingsTransferResult, key: typeof SUMMARY_KEYS[number]) {
    const item = result.summary[key]
    return t('settings.settingsImportSummary')
      .replace('{created}', String(item.created))
      .replace('{updated}', String(item.updated))
      .replace('{skipped}', String(item.skipped))
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-4">{t('settings.settingsTransfer')}</h2>
      <p className="text-xs text-muted mb-3">{t('settings.settingsTransferDesc')}</p>

      <label className="inline-flex items-center gap-2 text-sm text-text mb-3">
        <input
          type="checkbox"
          checked={includeSecrets}
          onChange={(event) => setIncludeSecrets(event.target.checked)}
          className="accent-accent"
        />
        {t('settings.includeSensitiveSettings')}
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
        >
          <Download size={14} />
          {t('settings.exportSettings')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
        >
          <Upload size={14} />
          {t('settings.importSettings')}
        </button>
      </div>

      {message && <p className="text-xs text-accent mt-2">{message}</p>}
      {error && <p className="text-xs text-error mt-2">{error}</p>}

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settings.settingsImportPreview')}</DialogTitle>
            {preview && (
              <DialogDescription>
                {SUMMARY_KEYS.map(key => (
                  <span key={key} className="block">
                    {key}: {formatSummary(preview, key)}
                  </span>
                ))}
              </DialogDescription>
            )}
          </DialogHeader>

          {preview && preview.warnings.length > 0 && (
            <div className="max-h-32 overflow-y-auto text-xs text-muted space-y-1">
              {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors"
            >
              {t('header.back')}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={busy || !preview?.ok}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {t('settings.settingsImportConfirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
```

- [ ] **Step 4: Render the section in DataTab**

In `src/pages/settings/data-tab.tsx`, import the section and render it for admin-like users after OPML and before social sources:

```tsx
import { SettingsTransferSection } from './sections/settings-transfer-section'
```

Then:

```tsx
      <DataSection />
      <Separator />
      {isAdminLike && (
        <>
          <SettingsTransferSection />
          <Separator />
          <SocialSourcesSection />
          <Separator />
        </>
      )}
```

Do not show the section to members because the backend endpoints are owner/admin only.

## Task 4: Frontend Tests

**Files:**
- Create: `src/pages/settings/sections/settings-transfer-section.test.tsx`

- [ ] **Step 1: Add component tests**

Create `src/pages/settings/sections/settings-transfer-section.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsTransferSection } from './settings-transfer-section'

const mockFetchSettingsExportBlob = vi.fn()
const mockPreviewSettingsImport = vi.fn()
const mockImportSettingsBundle = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetchSettingsExportBlob: (...args: unknown[]) => mockFetchSettingsExportBlob(...args),
  previewSettingsImport: (...args: unknown[]) => mockPreviewSettingsImport(...args),
  importSettingsBundle: (...args: unknown[]) => mockImportSettingsBundle(...args),
}))

vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

const result = {
  ok: true,
  summary: {
    instanceSettings: { created: 1, updated: 0, skipped: 0 },
    userSettings: { created: 0, updated: 2, skipped: 0 },
    customLlmProviders: { created: 0, updated: 0, skipped: 1 },
    notificationChannels: { created: 1, updated: 0, skipped: 0 },
  },
  warnings: ['Skipped custom LLM provider DeepSeek because api_key was redacted'],
  errors: [],
}

describe('SettingsTransferSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchSettingsExportBlob.mockResolvedValue(new Blob(['{}'], { type: 'application/json' }))
    mockPreviewSettingsImport.mockResolvedValue(result)
    mockImportSettingsBundle.mockResolvedValue(result)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('exports without secrets by default', async () => {
    render(<SettingsTransferSection />)
    await user.click(screen.getByText('Export Settings'))
    await waitFor(() => {
      expect(mockFetchSettingsExportBlob).toHaveBeenCalledWith(false)
    })
  })

  it('passes includeSecrets when the checkbox is enabled', async () => {
    render(<SettingsTransferSection />)
    await user.click(screen.getByLabelText('Include sensitive configuration'))
    await user.click(screen.getByText('Export Settings'))
    await waitFor(() => {
      expect(mockFetchSettingsExportBlob).toHaveBeenCalledWith(true)
    })
  })

  it('previews an imported JSON bundle before confirming import', async () => {
    render(<SettingsTransferSection />)
    const file = new File([JSON.stringify({ app: 'oksskolten', version: 1 })], 'settings.json', { type: 'application/json' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText('Import Preview')).toBeTruthy()
      expect(screen.getByText(/customLlmProviders:/)).toBeTruthy()
      expect(screen.getByText(/Skipped custom LLM provider/)).toBeTruthy()
    })

    await user.click(screen.getByText('Import Settings'))
    await waitFor(() => {
      expect(mockImportSettingsBundle).toHaveBeenCalledWith({ app: 'oksskolten', version: 1 })
    })
  })
})
```

- [ ] **Step 2: Run frontend tests**

Run:

```bash
npm test -- src/pages/settings/sections/settings-transfer-section.test.tsx src/pages/settings/sections/data-section.test.tsx
```

Expected: PASS.

## Task 5: Final Verification

**Files:**
- All files changed above.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
npm test -- server/routes/settings-transfer.test.ts server/routes/settings.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run targeted frontend tests**

Run:

```bash
npm test -- src/pages/settings/sections/settings-transfer-section.test.tsx src/pages/settings-page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

## Plan Self Review

- Spec coverage: the plan covers owner/admin JSON export/import, default redaction, optional secrets, exclusions, provider remapping, notification channel import, preview, transaction safety, frontend UI, and tests.
- Placeholder scan: no placeholders are present.
- Type consistency: route names, helper names, summary keys, and file paths are consistent across tasks.
