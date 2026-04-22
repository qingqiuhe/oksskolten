import OpenAI from 'openai'
import { getSetting } from '../../db.js'
import type { LLMProvider, LLMMessageParams, LLMStreamResult } from './provider.js'
import type { OpenAICompatibleConfig } from '../../llm-task-config.js'

let cachedKey = ''
let cachedBaseUrl = ''
let cachedClient: OpenAI | null = null

function normalizeBaseUrl(baseURL?: string): string {
  return baseURL?.trim().replace(/\/+$/, '') || ''
}

export function getOpenAIClient(userId?: number | null, openaiConfig?: OpenAICompatibleConfig): OpenAI {
  const key = openaiConfig?.apiKey?.trim() || getSetting('api_key.openai', userId) || ''
  const baseURL = normalizeBaseUrl(openaiConfig?.baseURL)
  if (cachedClient && key === cachedKey && baseURL === cachedBaseUrl) return cachedClient
  cachedKey = key
  cachedBaseUrl = baseURL
  cachedClient = new OpenAI({
    apiKey: key,
    ...(baseURL ? { baseURL } : {}),
  })
  return cachedClient
}

export const openaiProvider: LLMProvider = {
  name: 'openai',

  requireKey(userId, openaiConfig) {
    if (!(openaiConfig?.apiKey?.trim() || getSetting('api_key.openai', userId))) {
      throw new Error('OPENAI_KEY_NOT_SET')
    }
  },

  async createMessage(params: LLMMessageParams): Promise<LLMStreamResult> {
    const client = getOpenAIClient(params.userId, params.openaiConfig)
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (params.systemInstruction) {
      messages.push({ role: 'system', content: params.systemInstruction })
    }
    for (const m of params.messages) {
      messages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })
    }

    const response = await client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages,
    })

    const text = response.choices[0]?.message?.content ?? ''
    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    }
  },

  async streamMessage(params: LLMMessageParams, onText: (delta: string) => void): Promise<LLMStreamResult> {
    const client = getOpenAIClient(params.userId, params.openaiConfig)
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (params.systemInstruction) {
      messages.push({ role: 'system', content: params.systemInstruction })
    }
    for (const m of params.messages) {
      messages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })
    }

    const stream = await client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    })

    let fullText = ''
    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        fullText += delta
        onText(delta)
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens
        outputTokens = chunk.usage.completion_tokens ?? outputTokens
      }
    }

    return { text: fullText, inputTokens, outputTokens }
  },
}
