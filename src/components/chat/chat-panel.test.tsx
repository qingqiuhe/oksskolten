import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatPanel, type ChatState } from './chat-panel'
import type { ChatDebugTrace } from '../../../shared/types'

const { swrKeys } = vi.hoisted(() => ({
  swrKeys: [] as Array<string | null>,
}))

const { mockUseChat } = vi.hoisted(() => ({
  mockUseChat: vi.fn(),
}))

vi.mock('swr', () => ({
  default: (key: string | null) => {
    swrKeys.push(key)
    if (key?.startsWith('/api/chat/conversations?article_id=')) {
      return { data: { conversations: [{ id: 'conv-from-article' }] } }
    }
    return { data: undefined }
  },
}))

vi.mock('../../hooks/use-chat', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args),
  draftKeyFor: () => 'draft-test-key',
}))

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
    swrKeys.length = 0
    mockUseChat.mockReset()
    mockUseChat.mockReturnValue(makeChatState())
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
    expect(mockUseChat).not.toHaveBeenCalled()
  })

  it('uses internal chat state only when no external chat state is provided', () => {
    render(
      <ChatPanel
        variant="inline"
        scope={{ type: 'article', article_id: 42 }}
      />,
    )

    expect(mockUseChat).toHaveBeenCalledWith({ type: 'article', article_id: 42 })
  })

  it('looks up an article conversation when no conversation id is provided', async () => {
    const chatState = makeChatState()

    render(
      <ChatPanel
        variant="inline"
        chatState={chatState}
        scope={{ type: 'article', article_id: 42 }}
      />,
    )

    expect(swrKeys).toContain('/api/chat/conversations?article_id=42')
    await waitFor(() => {
      expect(chatState.loadConversation).toHaveBeenCalledWith('conv-from-article')
    })
  })

  it('skips the article conversation lookup when a conversation id is already known', async () => {
    const chatState = makeChatState()

    render(
      <ChatPanel
        variant="inline"
        chatState={chatState}
        scope={{ type: 'article', article_id: 42 }}
        conversationId="conv-known"
      />,
    )

    expect(swrKeys).not.toContain('/api/chat/conversations?article_id=42')
    await waitFor(() => {
      expect(chatState.loadConversation).toHaveBeenCalledWith('conv-known')
    })
  })
})
