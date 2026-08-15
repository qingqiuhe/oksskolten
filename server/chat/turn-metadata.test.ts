import { describe, it, expect } from 'vitest'
import { buildToolSummary, serializeTurnMetadata, parseTurnMetadata } from './turn-metadata.js'
import type { Message } from './types.js'

describe('turn-metadata', () => {
  it('buildToolSummary counts and sorts tool uses', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: '1', name: 'search_articles', input: {} },
          { type: 'tool_use', id: '2', name: 'read_article', input: {} },
          { type: 'tool_use', id: '3', name: 'search_articles', input: {} },
        ],
      },
    ]

    const summary = buildToolSummary(messages)
    expect(summary).toEqual([
      { name: 'search_articles', count: 2 },
      { name: 'read_article', count: 1 },
    ])
  })

  it('serializeTurnMetadata and parseTurnMetadata round-trip properly', () => {
    const meta = {
      provider: 'openai',
      model: 'gpt-4o',
      status: 'complete' as const,
      elapsed_ms: 1250,
      usage: { input_tokens: 100, output_tokens: 50 },
      tool_summary: [{ name: 'search_articles', count: 1 }],
    }
    const serialized = serializeTurnMetadata(meta)
    const parsed = parseTurnMetadata(serialized)
    expect(parsed).toEqual(meta)
  })

  it('parseTurnMetadata gracefully returns null for invalid or empty input', () => {
    expect(parseTurnMetadata(null)).toBeNull()
    expect(parseTurnMetadata('')).toBeNull()
    expect(parseTurnMetadata('invalid-json')).toBeNull()
    expect(parseTurnMetadata('{}')).toBeNull()
  })
})
