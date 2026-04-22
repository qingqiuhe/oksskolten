import { beforeEach, describe, expect, it } from 'vitest'
import { hashSync } from 'bcryptjs'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { createCustomLLMProvider, getDb, upsertSetting } from './db.js'
import { resolveLLMTaskConfig } from './llm-task-config.js'

function seedUser(userId = 1) {
  getDb().prepare(`
    INSERT INTO users (id, email, password_hash, role, status)
    VALUES (?, ?, ?, 'member', 'active')
  `).run(userId, `user${userId}@example.com`, hashSync('password123', 4))
  return userId
}

describe('resolveLLMTaskConfig', () => {
  beforeEach(() => {
    setupTestDb()
  })

  it('resolves built-in OpenAI without using legacy openai.base_url', () => {
    const userId = seedUser()
    upsertSetting('chat.provider', 'openai', userId)
    upsertSetting('chat.model', 'gpt-4.1-mini', userId)
    upsertSetting('openai.base_url', 'https://legacy.example/v1', userId)

    expect(resolveLLMTaskConfig('chat', userId)).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      providerInstanceId: null,
    })
  })

  it('resolves custom OpenAI-compatible provider credentials', () => {
    const userId = seedUser()
    const provider = createCustomLLMProvider({
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1/',
      api_key: 'sk-openrouter',
    }, userId)
    upsertSetting('chat.provider', 'openai', userId)
    upsertSetting('chat.provider_instance_id', String(provider.id), userId)
    upsertSetting('chat.model', 'deepseek-chat', userId)

    expect(resolveLLMTaskConfig('chat', userId)).toEqual({
      provider: 'openai',
      model: 'deepseek-chat',
      providerInstanceId: provider.id,
      openaiConfig: {
        apiKey: 'sk-openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
    })
  })

  it('throws when the selected custom provider does not exist', () => {
    const userId = seedUser()
    upsertSetting('chat.provider', 'openai', userId)
    upsertSetting('chat.provider_instance_id', '999', userId)

    expect(() => resolveLLMTaskConfig('chat', userId)).toThrow('Custom LLM provider 999 not found')
  })
})
