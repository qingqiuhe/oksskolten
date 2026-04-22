import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { upsertSetting, getSetting, createFeed, createNotificationChannel, upsertFeedNotificationRule, insertArticle, markArticleSeen, getDb, createCustomLLMProvider } from '../db.js'
import { hashSync } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Mocks — same as api.test.ts (needed for buildApp imports)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

function createAuthedUser(role: 'owner' | 'admin' | 'member') {
  const info = getDb().prepare(`
    INSERT INTO users (email, password_hash, role, status)
    VALUES (?, ?, ?, 'active')
  `).run(`${role}@example.com`, hashSync('password123', 4), role)

  return {
    authorization: `Bearer ${app.jwt.sign({
      sub: Number(info.lastInsertRowid),
      email: `${role}@example.com`,
      role,
      token_version: 0,
    })}`,
  }
}

function createAuthedUserWithId(role: 'owner' | 'admin' | 'member') {
  const email = `${role}-${Date.now()}@example.com`
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
  app = await buildApp()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// =========================================================================
// Provider-model consistency validation
// =========================================================================

describe('PATCH /api/settings/preferences — provider-model validation', () => {
  it('accepts valid anthropic provider and model', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'anthropic',
        'chat.model': 'claude-haiku-4-5-20251001',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['chat.provider']).toBe('anthropic')
    expect(res.json()['chat.model']).toBe('claude-haiku-4-5-20251001')
  })

  it('accepts valid gemini provider and model', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'gemini',
        'chat.model': 'gemini-2.5-flash',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['chat.provider']).toBe('gemini')
  })

  it('accepts valid openai provider and model', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'summary.provider': 'openai',
        'summary.model': 'gpt-4.1-mini',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts custom model names for openai-compatible APIs', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'summary.provider': 'openai',
        'summary.model': 'deepseek-chat',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['summary.model']).toBe('deepseek-chat')
  })

  it('rejects model that does not belong to provider', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'anthropic',
        'chat.model': 'gpt-4o',  // OpenAI model, not valid for anthropic
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not valid for provider/)
  })

  it('rejects gemini model with anthropic provider', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'translate.provider': 'anthropic',
        'translate.model': 'gemini-2.5-flash',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not valid for provider/)
  })

  it('validates against existing provider when only model is sent', async () => {
    // Set up: anthropic provider already saved
    upsertSetting('chat.provider', 'anthropic')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.model': 'gpt-4o',  // Doesn't match existing provider
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not valid for provider/)
  })

  it('validates against existing model when only provider is sent', async () => {
    // Set up: openai model already saved
    upsertSetting('chat.model', 'gpt-4o')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'anthropic',  // Doesn't match existing model
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not valid for provider/)
  })

  it('claude-code provider accepts anthropic model IDs', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'claude-code',
        'chat.model': 'claude-haiku-4-5-20251001',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['chat.provider']).toBe('claude-code')
  })

  it('claude-code provider rejects non-anthropic model', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'claude-code',
        'chat.model': 'gpt-4o',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not valid for provider/)
  })

  it('validates all three provider-model pairs independently', async () => {
    // Valid chat pair, invalid summary pair
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'anthropic',
        'chat.model': 'claude-haiku-4-5-20251001',
        'summary.provider': 'gemini',
        'summary.model': 'gpt-4o',  // Wrong: openai model with gemini provider
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not valid for provider/)
  })

  it('skips validation when provider or model is empty', async () => {
    // Only set provider without model — should pass (no model to validate against)
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'gemini',
      },
    })
    expect(res.statusCode).toBe(200)
  })
})

// =========================================================================
// AI provider enum validation
// =========================================================================

describe('PATCH /api/settings/preferences — AI provider/model enums', () => {
  it('accepts zh as a translation target language', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'translate.target_lang': 'zh' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['translate.target_lang']).toBe('zh')
  })

  it('rejects invalid provider value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'chat.provider': 'llama' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/chat\.provider/)
  })

  it('rejects invalid model value when provider is set', async () => {
    upsertSetting('chat.provider', 'anthropic')
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'chat.model': 'nonexistent-model-9000' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not valid for provider/)
  })

  it('accepts provider_instance_id when provider is openai and the custom provider exists', async () => {
    const { userId, headers } = createAuthedUserWithId('member')
    const provider = createCustomLLMProvider({
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-openrouter',
    }, userId)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: { ...json, ...headers },
      payload: {
        'chat.provider': 'openai',
        'chat.provider_instance_id': String(provider.id),
        'chat.model': 'deepseek-chat',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['chat.provider_instance_id']).toBe(String(provider.id))
    expect(getSetting('chat.provider_instance_id')).toBe(String(provider.id))
  })

  it('rejects provider_instance_id when provider is not openai', async () => {
    const { userId, headers } = createAuthedUserWithId('member')
    const provider = createCustomLLMProvider({
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-openrouter',
    }, userId)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: { ...json, ...headers },
      payload: {
        'chat.provider': 'anthropic',
        'chat.provider_instance_id': String(provider.id),
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/chat\.provider_instance_id can only be set/)
  })

  it('accepts all four valid provider values for chat', async () => {
    for (const provider of ['anthropic', 'gemini', 'openai', 'claude-code']) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/preferences',
        headers: json,
        payload: { 'chat.provider': provider },
      })
      expect(res.statusCode).toBe(200)
    }
  })

  it('accepts translate-only providers (google-translate, deepl) for translate.provider', async () => {
    for (const provider of ['google-translate', 'deepl']) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/preferences',
        headers: json,
        payload: { 'translate.provider': provider },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()['translate.provider']).toBe(provider)
    }
  })

  it('rejects translate-only providers for chat/summary', async () => {
    for (const provider of ['google-translate', 'deepl']) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/preferences',
        headers: json,
        payload: { 'chat.provider': provider },
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('skips model validation for google-translate and deepl providers', async () => {
    // Set a model that would fail validation for LLM providers
    upsertSetting('translate.model', 'gpt-4o')

    for (const provider of ['google-translate', 'deepl']) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/preferences',
        headers: json,
        payload: { 'translate.provider': provider },
      })
      // Should pass because model validation is skipped for these providers
      expect(res.statusCode).toBe(200)
    }
  })
})

// =========================================================================
// POST preferences endpoint (same handler as PATCH)
// =========================================================================

describe('POST /api/settings/preferences', () => {
  it('updates preferences via POST (same handler)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.date_mode': 'absolute' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['reading.date_mode']).toBe('absolute')
  })

  it('validates provider-model consistency via POST', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/preferences',
      headers: json,
      payload: {
        'chat.provider': 'gemini',
        'chat.model': 'claude-haiku-4-5-20251001',  // Wrong provider
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('fetch schedule settings endpoints', () => {
  it('GET returns the default minimum interval when unset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/fetch-schedule',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ min_interval_minutes: 15 })
  })

  it('PATCH stores a valid configured minimum interval', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/fetch-schedule',
      headers: json,
      payload: { min_interval_minutes: 5 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ min_interval_minutes: 5 })
    expect(getSetting('system.feed_min_check_interval_minutes')).toBe('5')
  })

  it('PATCH rejects values above the allowed range', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/fetch-schedule',
      headers: json,
      payload: { min_interval_minutes: 241 },
    })

    expect(res.statusCode).toBe(400)
  })

  it('PATCH rejects zero and negative values', async () => {
    const zeroRes = await app.inject({
      method: 'PATCH',
      url: '/api/settings/fetch-schedule',
      headers: json,
      payload: { min_interval_minutes: 0 },
    })
    const negativeRes = await app.inject({
      method: 'PATCH',
      url: '/api/settings/fetch-schedule',
      headers: json,
      payload: { min_interval_minutes: -1 },
    })

    expect(zeroRes.statusCode).toBe(400)
    expect(negativeRes.statusCode).toBe(400)
  })

  it('PATCH rejects non-integer values', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/fetch-schedule',
      headers: json,
      payload: { min_interval_minutes: 3.5 },
    })

    expect(res.statusCode).toBe(400)
  })

  it('PATCH rejects non-numeric values', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/fetch-schedule',
      headers: json,
      payload: { min_interval_minutes: 'five' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 403 for members', async () => {
    const savedAuthDisabled = process.env.AUTH_DISABLED
    delete process.env.AUTH_DISABLED

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/settings/fetch-schedule',
        headers: createAuthedUser('member'),
      })

      expect(res.statusCode).toBe(403)
    } finally {
      if (savedAuthDisabled !== undefined) {
        process.env.AUTH_DISABLED = savedAuthDisabled
      } else {
        delete process.env.AUTH_DISABLED
      }
    }
  })
})

describe('social source settings endpoints', () => {
  it('GET returns an empty RSSHub base url when unset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/social-sources',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ rsshub_base_url: '' })
  })

  it('PATCH stores a normalized RSSHub base url', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/social-sources',
      headers: json,
      payload: { rsshub_base_url: 'https://rsshub-gamma-ebon.vercel.app/' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ rsshub_base_url: 'https://rsshub-gamma-ebon.vercel.app' })
    expect(getSetting('social.rsshub_base_url')).toBe('https://rsshub-gamma-ebon.vercel.app')
  })

  it('PATCH rejects non-https urls', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/social-sources',
      headers: json,
      payload: { rsshub_base_url: 'http://rsshub.local' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/https/i)
  })
})

describe('notification task settings endpoints', () => {
  let savedAuthDisabled: string | undefined

  beforeEach(() => {
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

  it('lists only the current user tasks for members', async () => {
    const member = createAuthedUserWithId('member')
    const otherMember = createAuthedUserWithId('member')

    const feedA = createFeed({ name: 'My Feed', url: 'https://example.com/a' }, member.userId)
    const feedB = createFeed({ name: 'Other Feed', url: 'https://example.com/b' }, otherMember.userId)
    const channelA = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Mine',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/mine',
      secret: null,
      enabled: 1,
    }, member.userId)
    createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Other',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/other',
      secret: null,
      enabled: 1,
    }, otherMember.userId)

    upsertFeedNotificationRule(feedA.id, {
      enabled: true,
      translate_enabled: true,
      check_interval_minutes: 15,
      max_articles_per_message: 5,
      channel_ids: [channelA.id],
    }, member.userId)
    upsertFeedNotificationRule(feedB.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 30,
      channel_ids: [],
    }, otherMember.userId)

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/notification-tasks',
      headers: member.headers,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().scope).toBe('self')
    expect(res.json().tasks).toHaveLength(1)
    expect(res.json().tasks[0].feed.name).toBe('My Feed')
    expect(res.json().tasks[0].max_title_chars).toBe(100)
    expect(res.json().tasks[0].max_body_chars).toBe(1000)
    expect(res.json().tasks[0].channels).toEqual([{ id: channelA.id, name: 'Mine', enabled: 1 }])
  })

  it('lets admin view all tasks and manage member tasks only', async () => {
    const admin = createAuthedUserWithId('admin')
    const member = createAuthedUserWithId('member')
    const owner = createAuthedUserWithId('owner')

    const memberFeed = createFeed({ name: 'Member Feed', url: 'https://example.com/member' }, member.userId)
    const ownerFeed = createFeed({ name: 'Owner Feed', url: 'https://example.com/owner' }, owner.userId)
    const memberChannel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Member Channel',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/member',
      secret: null,
      enabled: 1,
    }, member.userId)

    const memberRule = upsertFeedNotificationRule(memberFeed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 20,
      max_articles_per_message: 4,
      channel_ids: [memberChannel.id],
    }, member.userId)
    const ownerRule = upsertFeedNotificationRule(ownerFeed.id, {
      enabled: true,
      translate_enabled: true,
      check_interval_minutes: 25,
      max_articles_per_message: 6,
      channel_ids: [],
    }, owner.userId)

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/settings/notification-tasks?scope=all',
      headers: admin.headers,
    })
    expect(listRes.statusCode).toBe(200)
    expect(listRes.json().scope).toBe('all')
    expect(listRes.json().tasks).toHaveLength(2)

    const updateMemberRes = await app.inject({
      method: 'PATCH',
      url: `/api/settings/notification-tasks/${memberRule.id}`,
      headers: { ...json, ...admin.headers },
      payload: {
        enabled: false,
        check_interval_minutes: 45,
        content_mode: 'title_only',
        max_articles_per_message: 7,
        max_title_chars: 140,
        max_body_chars: 640,
      },
    })
    expect(updateMemberRes.statusCode).toBe(200)
    expect(updateMemberRes.json().enabled).toBe(0)
    expect(updateMemberRes.json().check_interval_minutes).toBe(45)
    expect(updateMemberRes.json().content_mode).toBe('title_only')
    expect(updateMemberRes.json().max_articles_per_message).toBe(7)
    expect(updateMemberRes.json().max_title_chars).toBe(140)
    expect(updateMemberRes.json().max_body_chars).toBe(640)

    const updateOwnerRes = await app.inject({
      method: 'PATCH',
      url: `/api/settings/notification-tasks/${ownerRule.id}`,
      headers: { ...json, ...admin.headers },
      payload: {
        enabled: false,
      },
    })
    expect(updateOwnerRes.statusCode).toBe(403)
  })

  it('rejects cross-user channel edits but allows own channel edits', async () => {
    const owner = createAuthedUserWithId('owner')
    const member = createAuthedUserWithId('member')

    const ownerFeed = createFeed({ name: 'Owner Feed', url: 'https://example.com/owner-feed' }, owner.userId)
    const memberFeed = createFeed({ name: 'Member Feed', url: 'https://example.com/member-feed' }, member.userId)
    const ownerChannel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Owner Channel',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/owner',
      secret: null,
      enabled: 1,
    }, owner.userId)
    const memberChannel = createNotificationChannel({
      type: 'feishu_webhook',
      name: 'Member Channel',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/member2',
      secret: null,
      enabled: 1,
    }, member.userId)

    const ownerRule = upsertFeedNotificationRule(ownerFeed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 10,
      max_articles_per_message: 5,
      channel_ids: [ownerChannel.id],
    }, owner.userId)
    const memberRule = upsertFeedNotificationRule(memberFeed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 12,
      max_articles_per_message: 5,
      channel_ids: [memberChannel.id],
    }, member.userId)

    const ownUpdateRes = await app.inject({
      method: 'PATCH',
      url: `/api/settings/notification-tasks/${ownerRule.id}`,
      headers: { ...json, ...owner.headers },
      payload: {
        channel_ids: [],
      },
    })
    expect(ownUpdateRes.statusCode).toBe(200)
    expect(ownUpdateRes.json().channels).toEqual([])

    const crossUserRes = await app.inject({
      method: 'PATCH',
      url: `/api/settings/notification-tasks/${memberRule.id}`,
      headers: { ...json, ...owner.headers },
      payload: {
        channel_ids: [],
      },
    })
    expect(crossUserRes.statusCode).toBe(403)
  })

  it('allows owner to delete admin tasks', async () => {
    const owner = createAuthedUserWithId('owner')
    const admin = createAuthedUserWithId('admin')
    const adminFeed = createFeed({ name: 'Admin Feed', url: 'https://example.com/admin-feed' }, admin.userId)
    const adminRule = upsertFeedNotificationRule(adminFeed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 18,
      max_articles_per_message: 5,
      channel_ids: [],
    }, admin.userId)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/settings/notification-tasks/${adminRule.id}`,
      headers: owner.headers,
    })

    expect(res.statusCode).toBe(204)
    const remaining = getDb().prepare('SELECT COUNT(*) AS count FROM feed_notification_rules WHERE id = ?').get(adminRule.id) as { count: number }
    expect(remaining.count).toBe(0)
  })

  it('rejects invalid max_articles_per_message on task updates', async () => {
    const member = createAuthedUserWithId('member')
    const feed = createFeed({ name: 'Max Feed', url: 'https://example.com/max-feed' }, member.userId)
    const rule = upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 15,
      channel_ids: [],
    }, member.userId)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/settings/notification-tasks/${rule.id}`,
      headers: { ...json, ...member.headers },
      payload: {
        max_articles_per_message: 21,
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid max_title_chars on task updates', async () => {
    const member = createAuthedUserWithId('member')
    const feed = createFeed({ name: 'Title Feed', url: 'https://example.com/title-feed' }, member.userId)
    const rule = upsertFeedNotificationRule(feed.id, {
      enabled: true,
      translate_enabled: false,
      check_interval_minutes: 15,
      channel_ids: [],
    }, member.userId)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/settings/notification-tasks/${rule.id}`,
      headers: { ...json, ...member.headers },
      payload: {
        max_title_chars: 301,
      },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('notification channel settings endpoints', () => {
  it('creates channels with default timezone and updates timezone explicitly', async () => {
    const member = createAuthedUserWithId('member')

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/settings/notification-channels',
      headers: { ...json, ...member.headers },
      payload: {
        type: 'feishu_webhook',
        name: 'Team',
        webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      },
    })

    expect(createRes.statusCode).toBe(201)
    expect(createRes.json().timezone).toBe('UTC+8')

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/settings/notification-channels/${createRes.json().id}`,
      headers: { ...json, ...member.headers },
      payload: {
        timezone: 'UTC+9',
      },
    })

    expect(updateRes.statusCode).toBe(200)
    expect(updateRes.json().timezone).toBe('UTC+9')
  })

  it('rejects invalid channel timezone', async () => {
    const member = createAuthedUserWithId('member')

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/notification-channels',
      headers: { ...json, ...member.headers },
      payload: {
        type: 'feishu_webhook',
        name: 'Team',
        webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
        timezone: 'Asia/Shanghai',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/timezone must be one of/)
  })
})

// =========================================================================
// Boolean/on-off preferences
// =========================================================================

describe('PATCH /api/settings/preferences — on/off toggles', () => {
  it('accepts on/off for auto_mark_read', async () => {
    const resOn = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.auto_mark_read': 'on' },
    })
    expect(resOn.statusCode).toBe(200)
    expect(resOn.json()['reading.auto_mark_read']).toBe('on')

    const resOff = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.auto_mark_read': 'off' },
    })
    expect(resOff.statusCode).toBe(200)
    expect(resOff.json()['reading.auto_mark_read']).toBe('off')
  })

  it('rejects invalid on/off value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.auto_mark_read': 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid unread_indicator value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.unread_indicator': 'true' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid internal_links value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.internal_links': '1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid show_thumbnails value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.show_thumbnails': 'true' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts on/off for category_unread_only', async () => {
    const resOn = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.category_unread_only': 'on' },
    })
    expect(resOn.statusCode).toBe(200)
    expect(resOn.json()['reading.category_unread_only']).toBe('on')

    const resOff = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.category_unread_only': 'off' },
    })
    expect(resOff.statusCode).toBe(200)
    expect(resOff.json()['reading.category_unread_only']).toBe('off')
  })

  it('rejects invalid category_unread_only value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'reading.category_unread_only': 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// =========================================================================
// Profile — avatar_seed
// =========================================================================

describe('PATCH /api/settings/profile — avatar_seed', () => {
  it('updates avatar_seed', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: json,
      payload: { avatar_seed: 'my-seed-123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().avatar_seed).toBe('my-seed-123')
  })

  it('clears avatar_seed with null', async () => {
    // Set first
    await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: json,
      payload: { avatar_seed: 'seed' },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: json,
      payload: { avatar_seed: null },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().avatar_seed).toBeNull()
  })
})

// =========================================================================
// Profile — default account_name initialization
// =========================================================================

describe('GET /api/settings/profile — defaults', () => {
  it('initializes account_name from auth email on first access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/profile' })
    expect(res.statusCode).toBe(200)
    // Should auto-initialize
    expect(res.json().account_name).toBeDefined()
    expect(res.json().account_name.length).toBeGreaterThan(0)

    // Should persist after initialization
    const stored = getSetting('profile.account_name')
    expect(stored).toBe(res.json().account_name)
  })
})

// =========================================================================
// Provider API key management
// =========================================================================

describe('GET /api/settings/api-keys/:provider', () => {
  it('returns configured=false when no key set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/api-keys/anthropic',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().configured).toBe(false)
  })

  it('returns configured=true when key is set', async () => {
    upsertSetting('api_key.anthropic', 'sk-test')

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/api-keys/anthropic',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().configured).toBe(true)
  })

  it('returns 400 for unknown provider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/api-keys/unknown',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Unknown provider')
  })

  it('works for all known providers', async () => {
    for (const provider of ['anthropic', 'gemini', 'openai']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/settings/api-keys/${provider}`,
      })
      expect(res.statusCode).toBe(200)
    }
  })
})

describe('POST /api/settings/api-keys/:provider', () => {
  it('saves API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/api-keys/anthropic',
      headers: json,
      payload: { apiKey: 'sk-new-key' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().configured).toBe(true)
    expect(getSetting('api_key.anthropic')).toBe('sk-new-key')
  })

  it('deletes API key when empty', async () => {
    upsertSetting('api_key.anthropic', 'sk-old')

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/api-keys/anthropic',
      headers: json,
      payload: { apiKey: '' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().configured).toBe(false)
    expect(getSetting('api_key.anthropic')).toBeUndefined()
  })

  it('deletes API key when missing', async () => {
    upsertSetting('api_key.gemini', 'old-key')

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/api-keys/gemini',
      headers: json,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().configured).toBe(false)
  })

  it('trims whitespace from key', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/settings/api-keys/openai',
      headers: json,
      payload: { apiKey: '  sk-trimmed  ' },
    })
    expect(getSetting('api_key.openai')).toBe('sk-trimmed')
  })

  it('returns 400 for unknown provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/api-keys/deepseek',
      headers: json,
      payload: { apiKey: 'key' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('custom LLM providers', () => {
  it('creates and lists custom providers without exposing API keys', async () => {
    const { headers } = createAuthedUserWithId('member')

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/settings/custom-llm-providers',
      headers: { ...json, ...headers },
      payload: {
        name: 'OpenRouter',
        base_url: 'https://openrouter.ai/api/v1/',
        api_key: 'sk-openrouter',
      },
    })

    expect(createRes.statusCode).toBe(201)
    expect(createRes.json()).toEqual(expect.objectContaining({
      name: 'OpenRouter',
      kind: 'openai-compatible',
      base_url: 'https://openrouter.ai/api/v1',
      has_api_key: true,
    }))
    expect(createRes.json().api_key).toBeUndefined()

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/settings/custom-llm-providers',
      headers,
    })

    expect(listRes.statusCode).toBe(200)
    expect(listRes.json().providers).toEqual([
      expect.objectContaining({
        name: 'OpenRouter',
        kind: 'openai-compatible',
        base_url: 'https://openrouter.ai/api/v1',
        has_api_key: true,
      }),
    ])
    expect(listRes.json().providers[0].api_key).toBeUndefined()
  })

  it('updates custom provider metadata and keeps API keys write-only', async () => {
    const { userId, headers } = createAuthedUserWithId('member')
    const provider = createCustomLLMProvider({
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-openrouter',
    }, userId)

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/settings/custom-llm-providers/${provider.id}`,
      headers: { ...json, ...headers },
      payload: {
        name: 'DeepSeek',
        base_url: 'https://api.deepseek.com/v1',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(expect.objectContaining({
      id: provider.id,
      name: 'DeepSeek',
      base_url: 'https://api.deepseek.com/v1',
      has_api_key: true,
    }))
    expect(res.json().api_key).toBeUndefined()
  })

  it('blocks deleting a custom provider that is still assigned to a task', async () => {
    const { userId, headers } = createAuthedUserWithId('member')
    const provider = createCustomLLMProvider({
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-openrouter',
    }, userId)
    upsertSetting('chat.provider', 'openai', userId)
    upsertSetting('chat.provider_instance_id', String(provider.id), userId)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/settings/custom-llm-providers/${provider.id}`,
      headers,
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toContain('chat')
  })

  it('tests a custom provider and returns structured diagnostics on success', async () => {
    const { userId, headers } = createAuthedUserWithId('member')
    const provider = createCustomLLMProvider({
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-openrouter',
    }, userId)
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"id":"chatcmpl_test"}\n\n', {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-request-id': 'req_test',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.inject({
      method: 'POST',
      url: `/api/settings/custom-llm-providers/${provider.id}/test`,
      headers: { ...json, ...headers },
      payload: { model: 'openai/gpt-4.1-mini' },
    })

    expect(res.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(res.json()).toEqual(expect.objectContaining({
      ok: true,
      request: expect.objectContaining({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: expect.objectContaining({
          Authorization: '[REDACTED]',
          'Content-Type': 'application/json',
        }),
      }),
      response: expect.objectContaining({
        status: 200,
        statusText: '',
        headers: expect.objectContaining({
          'content-type': 'text/event-stream',
          'x-request-id': 'req_test',
        }),
        body: 'data: {"id":"chatcmpl_test"}\n\n',
      }),
    }))
    expect(res.json().request.body).toContain('"model": "openai/gpt-4.1-mini"')
  })

  it('wraps upstream auth failures as app errors and redacts request diagnostics', async () => {
    const { userId, headers } = createAuthedUserWithId('member')
    const provider = createCustomLLMProvider({
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-openrouter',
    }, userId)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'blocked' },
    }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: {
        'content-type': 'application/json',
      },
    })))

    const res = await app.inject({
      method: 'POST',
      url: `/api/settings/custom-llm-providers/${provider.id}/test`,
      headers: { ...json, ...headers },
      payload: { model: 'openai/gpt-4.1-mini' },
    })

    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual(expect.objectContaining({
      ok: false,
      error: 'Upstream returned 401 Unauthorized',
      request: expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: '[REDACTED]',
        }),
      }),
      response: expect.objectContaining({
        status: 401,
        statusText: 'Unauthorized',
      }),
    }))
    expect(res.json().request.body).not.toContain('sk-openrouter')
  })
})

// =========================================================================
// Retention policy endpoints
// =========================================================================

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('GET /api/settings/retention/stats', () => {
  it('returns zeros when retention is not configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/retention/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ readDays: 0, unreadDays: 0, readEligible: 0, unreadEligible: 0 })
  })

  it('returns eligible counts when configured', async () => {
    const feed = createFeed({ name: 'F', url: 'https://f.com' })
    const id = insertArticle({ feed_id: feed.id, title: 'Old', url: 'https://f.com/1', published_at: '2025-01-01T00:00:00Z' })
    markArticleSeen(id, true)
    getDb().prepare('UPDATE articles SET seen_at = ? WHERE id = ?').run(daysAgo(100), id)

    upsertSetting('retention.enabled', 'on')
    upsertSetting('retention.read_days', '90')
    upsertSetting('retention.unread_days', '180')

    const res = await app.inject({ method: 'GET', url: '/api/settings/retention/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json().readEligible).toBe(1)
    expect(res.json().readDays).toBe(90)
  })
})

describe('POST /api/settings/retention/purge', () => {
  it('returns 400 when retention is not enabled', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/settings/retention/purge' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/not enabled/)
  })

  it('returns purged: 0 when enabled but no days configured', async () => {
    upsertSetting('retention.enabled', 'on')

    const res = await app.inject({ method: 'POST', url: '/api/settings/retention/purge' })
    expect(res.statusCode).toBe(200)
    expect(res.json().purged).toBe(0)
  })

  it('purges eligible articles', async () => {
    const feed = createFeed({ name: 'F', url: 'https://f.com' })
    const id = insertArticle({ feed_id: feed.id, title: 'Old', url: 'https://f.com/1', published_at: '2025-01-01T00:00:00Z' })
    markArticleSeen(id, true)
    getDb().prepare('UPDATE articles SET seen_at = ? WHERE id = ?').run(daysAgo(100), id)

    upsertSetting('retention.enabled', 'on')
    upsertSetting('retention.read_days', '90')
    upsertSetting('retention.unread_days', '180')

    const res = await app.inject({ method: 'POST', url: '/api/settings/retention/purge' })
    expect(res.statusCode).toBe(200)
    expect(res.json().purged).toBe(1)
  })
})

describe('PATCH /api/settings/preferences — retention validation', () => {
  it('accepts valid retention day values', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '90', 'retention.unread_days': '180' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects non-integer retention days', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '3.5' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects zero retention days', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '0' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects negative retention days', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.unread_days': '-10' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects retention days exceeding 9999', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/preferences',
      headers: json,
      payload: { 'retention.read_days': '10000' },
    })
    expect(res.statusCode).toBe(400)
  })
})
