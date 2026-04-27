import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatPanel, type ChatState } from './chat-panel'
import type { ChatDebugTrace } from '../../../shared/types'

vi.mock('../../hooks/use-escape-key', () => ({
  useEscapeKey: vi.fn(),
}))

const trace: ChatDebugTrace = {
  meta: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    started_at: '2026-04-27T00:00:00.000Z',
    elapsed_ms: 100,
    scope: null,
    scope_summary: null,
  },
  system: 'system',
  input: { messages: [{ role: 'user', content: 'hi' }] },
  provider_request: { model: 'gpt-4.1-mini' },
  tool_rounds: [],
  provider_response: { finish_reason: 'stop' },
  output: { text: 'hello' },
}

function makeChatState(): ChatState {
  return {
    messages: [{ role: 'assistant', text: 'hello', debugTrace: trace }],
    conversationId: 'conv-1',
    streaming: false,
    thinking: false,
    activeTool: null,
    error: null,
    sendMessage: vi.fn(),
    loadConversation: vi.fn(async () => {}),
    reset: vi.fn(),
  }
}

describe('ChatPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows debug toggle and reveals debug panel when enabled', async () => {
    render(
      <ChatPanel
        variant="full"
        chatState={makeChatState()}
        scopeSummary={{ type: 'global', label: 'Global' }}
      />,
    )

    expect(screen.queryByText('Debug Trace')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))

    await waitFor(() => {
      expect(localStorage.getItem('chat-debug-mode')).toBe('on')
    })

    expect(screen.getByText('Debug Trace')).toBeTruthy()
  })
})
