import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { MessagesSquare } from 'lucide-react'
import { ChatPanel } from './chat-panel'
import { ActionChip } from '../ui/action-chip'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import { buildArticleScope } from '../../lib/chat-scope'
import type { ScopeSummary } from '../../../shared/types'

interface ChatInlineProps {
  articleId: number
}

export function useChatInline(articleId: number, enabled = true) {
  const [open, setOpen] = useState(false)

  const { data: existingConv } = useSWR<{ conversations: { id: string }[] }>(
    enabled && articleId ? `/api/chat/conversations?article_id=${articleId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  // Auto-open if article already has conversations
  useEffect(() => {
    if (enabled && existingConv?.conversations?.length) {
      setOpen(true)
    }
  }, [enabled, existingConv])

  return {
    open,
    conversationId: existingConv?.conversations?.[0]?.id,
    toggle: () => setOpen(prev => !prev),
    close: () => setOpen(false),
  }
}

export function ChatInlineTrigger({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <ActionChip active={active} onClick={onToggle}>
      <MessagesSquare className="w-3.5 h-3.5" />
      {t('article.askQuestion')}
    </ActionChip>
  )
}

export function ChatInlinePanel({ articleId, onClose, scopeSummary, conversationId }: { articleId: number; onClose: () => void; scopeSummary?: ScopeSummary | null; conversationId?: string }) {
  return (
    <div className="mt-2 mb-6">
      <ChatPanel
        variant="inline"
        scope={buildArticleScope(articleId)}
        scopeSummary={scopeSummary}
        conversationId={conversationId}
        onClose={onClose}
      />
    </div>
  )
}

/** @deprecated Use useChatInline + ChatInlineTrigger + ChatInlinePanel instead */
export function ChatInline({ articleId }: ChatInlineProps) {
  const chat = useChatInline(articleId)

  return (
    <>
      <ChatInlineTrigger active={chat.open} onToggle={chat.toggle} />
      {chat.open && (
        <div className="basis-full mt-2">
          <ChatPanel
            variant="inline"
            scope={buildArticleScope(articleId)}
            conversationId={chat.conversationId}
            onClose={chat.close}
          />
        </div>
      )}
    </>
  )
}
