import { CHAT_MAX_TOKENS } from '../../chat/tool-loop.js'
import { toOpenAITools } from '../../chat/tools.js'
import type { CustomLLMProviderSecret } from '../../db/custom-llm-providers.js'
import { buildOpenAICompatibleChatCompletionsUrl, buildOpenAICompatibleHeaders, fetchOpenAICompatibleChatCompletion, type OpenAICompatibleChatRequest } from './openai-compatible.js'

const TEST_TIMEOUT_MS = 15_000
const TEST_MAX_COMPLETION_TOKENS = Math.min(CHAT_MAX_TOKENS, 32)
const MAX_RESPONSE_BODY_CHARS = 16_000

export interface ProviderDiagnosticSnapshot {
  method: 'POST'
  url: string
  headers: Record<string, string>
  body: string
}

export interface ProviderDiagnosticResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export interface ProviderDiagnosticResult {
  ok: boolean
  duration_ms: number
  request: ProviderDiagnosticSnapshot
  response: ProviderDiagnosticResponse | null
  error?: string
}

function redactValue(value: string, secrets: string[]): string {
  let result = value
  for (const secret of secrets) {
    if (!secret) continue
    result = result.split(secret).join('[REDACTED]')
  }

  result = result.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  result = result.replace(/("authorization"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
  result = result.replace(/("api[_-]?key"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
  result = result.replace(/("set-cookie"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED]$3')

  return result
}

function redactHeaders(headers: Record<string, string>, secrets: string[]): Record<string, string> {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-api-key' || key.toLowerCase() === 'api-key') {
      redacted[key] = '[REDACTED]'
      continue
    }
    redacted[key] = redactValue(value, secrets)
  }
  return redacted
}

function responseHeadersToObject(headers: Headers, secrets: string[]): Record<string, string> {
  const entries = [...headers.entries()].sort(([a], [b]) => a.localeCompare(b))
  return redactHeaders(Object.fromEntries(entries), secrets)
}

function buildRequestBody(model: string): OpenAICompatibleChatRequest {
  return {
    model,
    max_completion_tokens: TEST_MAX_COMPLETION_TOKENS,
    messages: [
      { role: 'system', content: 'You are a connectivity test. Reply with exactly OK.' },
      { role: 'user', content: 'Reply with exactly OK.' },
    ],
    tools: toOpenAITools(),
    stream: true,
    stream_options: { include_usage: true },
  }
}

function truncateBody(text: string): string {
  if (text.length <= MAX_RESPONSE_BODY_CHARS) return text
  return `${text.slice(0, MAX_RESPONSE_BODY_CHARS)}\n...[truncated]`
}

export async function runOpenAICompatibleDiagnostics(
  provider: CustomLLMProviderSecret,
  model: string,
): Promise<ProviderDiagnosticResult> {
  const url = buildOpenAICompatibleChatCompletionsUrl(provider.base_url)
  const requestHeaders = buildOpenAICompatibleHeaders(provider.api_key)
  const requestBody = buildRequestBody(model)
  const secrets = [provider.api_key]

  const request: ProviderDiagnosticSnapshot = {
    method: 'POST',
    url,
    headers: redactHeaders(requestHeaders, secrets),
    body: redactValue(JSON.stringify(requestBody, null, 2), secrets),
  }

  const startedAt = Date.now()

  try {
    const response = await fetchOpenAICompatibleChatCompletion(requestBody, {
      apiKey: provider.api_key,
      baseURL: provider.base_url,
    }, TEST_TIMEOUT_MS)
    const responseBody = truncateBody(await response.text())
    const duration_ms = Date.now() - startedAt

    return {
      ok: response.ok,
      duration_ms,
      request,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeadersToObject(response.headers, secrets),
        body: redactValue(responseBody, secrets),
      },
      ...(response.ok ? {} : { error: `Upstream returned ${response.status} ${response.statusText}` }),
    }
  } catch (error) {
    return {
      ok: false,
      duration_ms: Date.now() - startedAt,
      request,
      response: null,
      error: error instanceof Error ? redactValue(error.message, secrets) : 'Unknown error',
    }
  }
}
