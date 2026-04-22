import { TASK_DEFAULTS } from '../shared/models.js'
import { getSetting, getCustomLLMProviderSecretById } from './db.js'

export type LLMTaskName = 'chat' | 'summary' | 'translate'

export interface OpenAICompatibleConfig {
  apiKey: string
  baseURL: string
}

export interface ResolvedLLMTaskConfig {
  provider: string
  model: string
  providerInstanceId: number | null
  openaiConfig?: OpenAICompatibleConfig
}

const TASK_PREF_KEYS: Record<LLMTaskName, {
  providerKey: 'chat.provider' | 'summary.provider' | 'translate.provider'
  modelKey: 'chat.model' | 'summary.model' | 'translate.model'
  providerInstanceKey: 'chat.provider_instance_id' | 'summary.provider_instance_id' | 'translate.provider_instance_id'
}> = {
  chat: {
    providerKey: 'chat.provider',
    modelKey: 'chat.model',
    providerInstanceKey: 'chat.provider_instance_id',
  },
  summary: {
    providerKey: 'summary.provider',
    modelKey: 'summary.model',
    providerInstanceKey: 'summary.provider_instance_id',
  },
  translate: {
    providerKey: 'translate.provider',
    modelKey: 'translate.model',
    providerInstanceKey: 'translate.provider_instance_id',
  },
}

const TASK_DEFAULT_CONFIG: Record<LLMTaskName, { provider: string; model: string }> = {
  chat: TASK_DEFAULTS.chat,
  summary: TASK_DEFAULTS.summarize,
  translate: TASK_DEFAULTS.translate,
}

export function resolveLLMTaskConfig(task: LLMTaskName, userId?: number | null): ResolvedLLMTaskConfig {
  const keys = TASK_PREF_KEYS[task]
  const defaults = TASK_DEFAULT_CONFIG[task]
  const provider = getSetting(keys.providerKey, userId) || defaults.provider
  const model = getSetting(keys.modelKey, userId) || defaults.model
  const providerInstanceRaw = getSetting(keys.providerInstanceKey, userId)
  const providerInstanceId = providerInstanceRaw ? Number(providerInstanceRaw) : null

  if (provider !== 'openai' || providerInstanceId == null) {
    return { provider, model, providerInstanceId: null }
  }

  const customProvider = getCustomLLMProviderSecretById(providerInstanceId, userId)
  if (!customProvider) {
    throw new Error(`Custom LLM provider ${providerInstanceId} not found`)
  }

  return {
    provider,
    model,
    providerInstanceId,
    openaiConfig: {
      apiKey: customProvider.api_key,
      baseURL: customProvider.base_url,
    },
  }
}
