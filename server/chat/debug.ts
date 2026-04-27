import type { ChatDebugMessage, ChatDebugToolRound, ChatDebugTrace, ChatScope, ScopeSummary } from '../../shared/types.js'
import type { Message } from './types.js'

const MAX_DEBUG_STRING_CHARS = 8_000
const MAX_DEBUG_ARRAY_ITEMS = 50
const MAX_DEBUG_OBJECT_KEYS = 50
const MAX_DEBUG_DEPTH = 6

const REDACTED = '[REDACTED]'
const TRUNCATED = '[TRUNCATED]'
const SENSITIVE_KEY_NAMES = new Set([
  'authorization',
  'api_key',
  'apikey',
  'x-api-key',
  'cookie',
  'set-cookie',
  'token',
  'secret',
  'password',
])

function truncateString(value: string): string {
  if (value.length <= MAX_DEBUG_STRING_CHARS) return value
  return `${value.slice(0, MAX_DEBUG_STRING_CHARS)}\n...[truncated]`
}

function redactString(value: string, secrets: string[]): string {
  let result = value
  for (const secret of secrets) {
    if (!secret) continue
    result = result.split(secret).join(REDACTED)
  }
  result = result.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  return result
}

function sanitizeValue(value: unknown, secrets: string[], depth = 0): unknown {
  if (value == null) return value
  if (depth > MAX_DEBUG_DEPTH) return TRUNCATED

  if (typeof value === 'string') {
    return truncateString(redactString(value, secrets))
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DEBUG_ARRAY_ITEMS).map(item => sanitizeValue(item, secrets, depth + 1))
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_DEBUG_OBJECT_KEYS)
    return Object.fromEntries(entries.map(([key, item]) => {
      if (SENSITIVE_KEY_NAMES.has(key.toLowerCase())) {
        return [key, REDACTED]
      }
      return [key, sanitizeValue(item, secrets, depth + 1)]
    }))
  }
  return String(value)
}

export interface ChatDebugCollector {
  setProviderRequest(payload: unknown, secrets?: string[]): void
  setProviderResponse(payload: unknown, secrets?: string[]): void
  recordToolRound(entry: {
    tool_use_id: string
    name: string
    input: unknown
    result?: unknown
    error?: string | null
    is_error?: boolean
    duration_ms: number
  }, secrets?: string[]): void
  finalize(params: {
    elapsed_ms: number
    text: string
    usage?: { input_tokens: number; output_tokens: number }
    error?: string | null
  }, secrets?: string[]): ChatDebugTrace
  getTrace(): ChatDebugTrace
}

function normalizeMessages(messages: Message[], secrets: string[]): ChatDebugMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: sanitizeValue(message.content, secrets),
  }))
}

export function createChatDebugCollector(params: {
  provider: string
  model: string
  system: string
  messages: Message[]
  scope?: ChatScope
  scopeSummary: ScopeSummary | null
}): ChatDebugCollector {
  const trace: ChatDebugTrace = {
    meta: {
      provider: params.provider,
      model: params.model,
      started_at: new Date().toISOString(),
      elapsed_ms: 0,
      scope: params.scope ?? null,
      scope_summary: params.scopeSummary,
    },
    system: truncateString(params.system),
    input: {
      messages: normalizeMessages(params.messages, []),
    },
    provider_request: null,
    tool_rounds: [],
    provider_response: null,
    output: {
      text: '',
    },
  }

  return {
    setProviderRequest(payload, secrets = []) {
      trace.provider_request = sanitizeValue(payload, secrets)
    },
    setProviderResponse(payload, secrets = []) {
      trace.provider_response = sanitizeValue(payload, secrets)
    },
    recordToolRound(entry, secrets = []) {
      const toolRound: ChatDebugToolRound = {
        tool_use_id: entry.tool_use_id,
        name: entry.name,
        input: sanitizeValue(entry.input, secrets),
        duration_ms: entry.duration_ms,
        ...(entry.result === undefined ? {} : { result: sanitizeValue(entry.result, secrets) }),
        ...(entry.error === undefined ? {} : { error: entry.error }),
        ...(entry.is_error === undefined ? {} : { is_error: entry.is_error }),
      }
      trace.tool_rounds.push(toolRound)
    },
    finalize(finalParams, secrets = []) {
      trace.meta.elapsed_ms = finalParams.elapsed_ms
      trace.output = {
        text: truncateString(redactString(finalParams.text, secrets)),
        ...(finalParams.usage ? { usage: finalParams.usage } : {}),
        ...(finalParams.error === undefined ? {} : { error: finalParams.error }),
      }
      return trace
    },
    getTrace() {
      return trace
    },
  }
}
