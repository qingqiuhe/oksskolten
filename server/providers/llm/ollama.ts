import OpenAI from 'openai'
import { getSettings } from '../../db.js'
import type { LLMProvider, LLMMessageParams, LLMStreamResult } from './provider.js'

let cachedBaseUrl = ''
let cachedHeaders = ''
let cachedClient: OpenAI | null = null
const OLLAMA_SETTING_KEYS = ['ollama.base_url', 'ollama.custom_headers'] as const

export interface OllamaConnectionConfig {
  baseUrl: string
  headersJson: string
  headers: Record<string, string>
}

function parseOllamaCustomHeaders(raw?: string): Record<string, string> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export function getOllamaConnectionConfig(userId?: number | null): OllamaConnectionConfig {
  const settings = getSettings(OLLAMA_SETTING_KEYS, userId)
  const baseUrl = settings['ollama.base_url'] || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const headersJson = settings['ollama.custom_headers'] || ''
  return {
    baseUrl,
    headersJson,
    headers: parseOllamaCustomHeaders(headersJson),
  }
}

export function getOllamaBaseUrl(userId?: number | null): string {
  return getOllamaConnectionConfig(userId).baseUrl
}

export function getOllamaCustomHeaders(userId?: number | null): Record<string, string> {
  return getOllamaConnectionConfig(userId).headers
}

export function getOllamaClient(userId?: number | null): OpenAI {
  const { baseUrl, headersJson, headers } = getOllamaConnectionConfig(userId)
  if (cachedClient && baseUrl === cachedBaseUrl && headersJson === cachedHeaders) return cachedClient
  cachedBaseUrl = baseUrl
  cachedHeaders = headersJson
  cachedClient = new OpenAI({
    baseURL: `${baseUrl}/v1`,
    apiKey: 'ollama',  // Ollama ignores this but the SDK requires it
    defaultHeaders: headers,
  })
  return cachedClient
}

export const ollamaProvider: LLMProvider = {
  name: 'ollama',

  requireKey() {
    // no-op: no API key needed (same pattern as claude-code)
    return undefined
  },

  async createMessage(params: LLMMessageParams): Promise<LLMStreamResult> {
    const client = getOllamaClient(params.userId)
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
    const client = getOllamaClient(params.userId)
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
