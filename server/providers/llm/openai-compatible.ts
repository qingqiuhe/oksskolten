import type OpenAI from 'openai'
import type { OpenAICompatibleConfig } from '../../llm-task-config.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_ERROR_BODY_CHARS = 500

export interface OpenAICompatibleChatRequest {
  model: string
  max_completion_tokens: number
  messages: OpenAI.ChatCompletionMessageParam[]
  tools?: unknown[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
}

function normalizeBaseUrl(baseURL?: string): string {
  return baseURL?.trim().replace(/\/+$/, '') || ''
}

export function isCustomOpenAICompatibleConfig(openaiConfig?: OpenAICompatibleConfig): boolean {
  return !!normalizeBaseUrl(openaiConfig?.baseURL)
}

export function buildOpenAICompatibleChatCompletionsUrl(baseURL: string): string {
  return `${normalizeBaseUrl(baseURL)}/chat/completions`
}

export function buildOpenAICompatibleHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function resolveRequiredConfig(openaiConfig?: OpenAICompatibleConfig): { apiKey: string; baseURL: string } {
  const apiKey = openaiConfig?.apiKey?.trim() || ''
  const baseURL = normalizeBaseUrl(openaiConfig?.baseURL)
  if (!apiKey || !baseURL) {
    throw new Error('OPENAI_COMPATIBLE_CONFIG_REQUIRED')
  }
  return { apiKey, baseURL }
}

export async function fetchOpenAICompatibleChatCompletion(
  body: OpenAICompatibleChatRequest,
  openaiConfig?: OpenAICompatibleConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const { apiKey, baseURL } = resolveRequiredConfig(openaiConfig)
  return fetch(buildOpenAICompatibleChatCompletionsUrl(baseURL), {
    method: 'POST',
    headers: buildOpenAICompatibleHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function extractErrorDetail(bodyText: string): string {
  const trimmed = bodyText.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as { error?: string | { message?: string } }
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim()
    if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim()
    }
  } catch {
    // fall through to plain text body
  }
  return trimmed
}

export async function throwIfOpenAICompatibleError(response: Response): Promise<void> {
  if (response.ok) return
  const bodyText = await response.text().catch(() => '')
  const detail = extractErrorDetail(bodyText).slice(0, MAX_ERROR_BODY_CHARS)
  throw new Error(`${response.status} ${detail || response.statusText}`.trim())
}

export async function* iterateOpenAICompatibleStreamEvents(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) {
    throw new Error('Response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

    while (true) {
      const separatorIndex = buffer.indexOf('\n\n')
      if (separatorIndex === -1) break

      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)

      const payload = rawEvent
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')

      if (!payload || payload === '[DONE]') continue

      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>
      } catch {
        continue
      }
      yield parsed
    }
  }
}
