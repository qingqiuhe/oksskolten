import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { LocaleContext } from '../../lib/i18n'
import { ListChatFab } from './list-chat-fab'

vi.mock('../../hooks/use-chat', () => ({
  useChat: () => ({
    messages: [],
    conversationId: null,
    streaming: false,
    thinking: false,
    activeTool: null,
    error: null,
    sendMessage: vi.fn(),
    loadConversation: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  }),
}))

vi.mock('./chat-panel', () => ({
  ChatPanel: ({ scopeControl }: { scopeControl?: ReactNode }) => (
    <div data-testid="chat-panel">{scopeControl}</div>
  ),
}))

describe('ListChatFab', () => {
  it('shows an icon-based article count pill instead of a bare number', async () => {
    const user = userEvent.setup()

    render(
      <LocaleContext.Provider value={{ locale: 'zh', setLocale: vi.fn() }}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <ListChatFab
            listLabel="当前列表"
            articleIds={[101, 102]}
            sourceFilters={{}}
          />
        </SWRConfig>
      </LocaleContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: '聊天' }))

    const countText = await screen.findByText('2 篇')
    const countPill = countText.closest('span')
    expect(countPill?.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText(/^2$/)).toBeNull()
  })
})
