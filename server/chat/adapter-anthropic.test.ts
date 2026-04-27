import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { upsertSetting } from '../db.js'
import { createChatDebugCollector } from './debug.js'

const mockStreamFactory = vi.fn()

vi.mock('./tools.js', () => ({
  toAnthropicTools: () => [{ name: 'search_articles', description: 'Search', input_schema: { type: 'object', properties: {} } }],
  executeTool: vi.fn(),
}))

vi.mock('../providers/llm/anthropic.js', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: (...args: unknown[]) => mockStreamFactory(...args),
    },
  }),
  anthropicProvider: { name: 'anthropic', requireKey: () => {}, createMessage: vi.fn(), streamMessage: vi.fn() },
}))

function createMockAnthropicStream(finalMessage: {
  content: Anthropic.ContentBlock[]
  usage: { input_tokens: number; output_tokens: number }
  stop_reason: 'tool_use' | 'end_turn' | null
}) {
  const handlers = new Map<string, ((payload: unknown) => void)[]>()

  return {
    on(event: string, handler: (payload: unknown) => void) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    async finalMessage() {
      for (const handler of handlers.get('contentBlock') ?? []) {
        for (const block of finalMessage.content) handler(block)
      }
      for (const handler of handlers.get('text') ?? []) {
        for (const block of finalMessage.content) {
          if (block.type === 'text') handler(block.text)
        }
      }
      return finalMessage
    },
  }
}

describe('runAnthropicTurn', () => {
  beforeEach(() => {
    setupTestDb()
    mockStreamFactory.mockReset()
  })

  it('captures provider request and response in debug trace', async () => {
    upsertSetting('api_key.anthropic', 'test-key')
    mockStreamFactory.mockReturnValue(createMockAnthropicStream({
      content: [{ type: 'text', text: 'Hello from Claude' } as Anthropic.TextBlock],
      usage: { input_tokens: 7, output_tokens: 3 },
      stop_reason: 'end_turn',
    }))

    const { runAnthropicTurn } = await import('./adapter-anthropic.js')
    const debugCollector = createChatDebugCollector({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      scopeSummary: null,
    })

    const result = await runAnthropicTurn({
      messages: [{ role: 'user', content: 'hi' }],
      system: 'sys',
      model: 'claude-haiku-4-5-20251001',
      debugCollector,
      onEvent: vi.fn(),
    })

    const trace = debugCollector.getTrace()
    expect((trace.provider_request as { transport?: string }).transport).toBe('anthropic-sdk')
    expect((trace.provider_response as { stop_reason?: string }).stop_reason).toBe('end_turn')
    expect(result.usage).toEqual({ input_tokens: 7, output_tokens: 3 })
  })
})
