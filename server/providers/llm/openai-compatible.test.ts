import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildOpenAICompatibleHeaders,
  fetchOpenAICompatibleChatCompletion,
  iterateOpenAICompatibleStreamEvents,
  throwIfOpenAICompatibleError,
} from './openai-compatible.js'

function makeSSEBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('\n\n') + '\n\n'))
      controller.close()
    },
  })
}

describe('openai-compatible raw transport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds minimal auth headers', () => {
    expect(buildOpenAICompatibleHeaders('sk-test')).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    })
  })

  it('sends only minimal headers for raw chat completions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOpenAICompatibleChatCompletion({
      model: 'gpt-5.4',
      max_completion_tokens: 32,
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      apiKey: 'sk-test',
      baseURL: 'https://provider.example/v1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
      }),
    )
  })

  it('parses SSE events and skips [DONE]', async () => {
    const response = new Response(makeSSEBody([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
      'data: [DONE]',
    ]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })

    const events: Record<string, unknown>[] = []
    for await (const event of iterateOpenAICompatibleStreamEvents(response)) {
      events.push(event)
    }

    expect(events).toHaveLength(2)
    expect(events[0].choices).toBeDefined()
    expect(events[1].usage).toEqual({ prompt_tokens: 5, completion_tokens: 2 })
  })

  it('throws upstream plain-text error bodies verbatim', async () => {
    await expect(throwIfOpenAICompatibleError(new Response('Your request was blocked.', {
      status: 403,
      statusText: 'Forbidden',
    }))).rejects.toThrow('403 Your request was blocked.')
  })

  it('throws upstream JSON error message bodies', async () => {
    await expect(throwIfOpenAICompatibleError(new Response(JSON.stringify({
      error: { message: 'blocked by policy' },
    }), {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'content-type': 'application/json' },
    }))).rejects.toThrow('403 blocked by policy')
  })
})
