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

vi.mock('../anthropic.js', () => ({
  anthropic: { messages: { stream: vi.fn(), create: vi.fn() } },
}))

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

const originalAuthDisabled = process.env.AUTH_DISABLED

beforeEach(async () => {
  process.env.AUTH_DISABLED = '0'
  setupTestDb()
  invalidateSocialRssHubBaseUrlCache()
  app = await buildApp()
})

afterEach(() => {
  process.env.AUTH_DISABLED = originalAuthDisabled
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

  it('rejects invalid reading.date_mode without writing valid values', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      instanceSettings: [{ key: 'social.rsshub_base_url', value: 'https://rsshub.example.com' }],
      userSettings: [{ key: 'reading.date_mode', value: 'bogus' }],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('social.rsshub_base_url')).toBeUndefined()
    expect(getSetting('reading.date_mode', owner.userId)).toBeUndefined()
  })

  it('rejects invalid retention.read_days and writes no partial state', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      userSettings: [
        { key: 'appearance.color_theme', value: 'nord' },
        { key: 'retention.read_days', value: 'abc' },
      ],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('appearance.color_theme', owner.userId)).toBeUndefined()
    expect(getSetting('retention.read_days', owner.userId)).toBeUndefined()
  })

  it('rejects invalid chat.provider', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      userSettings: [{ key: 'chat.provider', value: 'bogus' }],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('chat.provider', owner.userId)).toBeUndefined()
  })

  it('rejects invalid chat.provider_instance_id', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      userSettings: [{ key: 'chat.provider_instance_id', value: 'abc' }],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('chat.provider_instance_id', owner.userId)).toBeUndefined()
  })

  it('rejects invalid images.storage', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      instanceSettings: [{ key: 'images.storage', value: 'bogus' }],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('images.storage')).toBeUndefined()
  })

  it('rejects mismatched provider and model', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      userSettings: [
        { key: 'chat.provider', value: 'anthropic' },
        { key: 'chat.model', value: 'gemini-2.5-flash' },
      ],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('chat.provider', owner.userId)).toBeUndefined()
    expect(getSetting('chat.model', owner.userId)).toBeUndefined()
  })

  it('rejects custom provider instance ID when provider is not openai', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      customLlmProviders: [{
        id: 77,
        name: 'DeepSeek',
        kind: 'openai-compatible',
        base_url: 'https://api.deepseek.com',
        api_key: 'deepseek-secret',
      }],
      userSettings: [
        { key: 'chat.provider', value: 'anthropic' },
        { key: 'chat.provider_instance_id', value: '77' },
      ],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(getSetting('chat.provider', owner.userId)).toBeUndefined()
    expect(getSetting('chat.provider_instance_id', owner.userId)).toBeUndefined()
    const providerCount = getDb().prepare('SELECT count(*) as count FROM custom_llm_providers WHERE user_id = ?').get(owner.userId) as { count: number }
    expect(providerCount.count).toBe(0)
  })

  it('allows custom provider instance ID when provider is openai and remaps successfully', async () => {
    const owner = createAuthedUser('owner')
    const payload = {
      app: 'oksskolten',
      version: 1,
      customLlmProviders: [{
        id: 77,
        name: 'DeepSeek',
        kind: 'openai-compatible',
        base_url: 'https://api.deepseek.com',
        api_key: 'deepseek-secret',
      }],
      userSettings: [
        { key: 'chat.provider', value: 'openai' },
        { key: 'chat.provider_instance_id', value: '77' },
      ],
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/import',
      headers: { ...owner.headers, ...json },
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(getSetting('chat.provider', owner.userId)).toBe('openai')
    const localProviderId = getSetting('chat.provider_instance_id', owner.userId)
    expect(localProviderId).toMatch(/^\d+$/)
    expect(localProviderId).not.toBe('77')
  })
})
