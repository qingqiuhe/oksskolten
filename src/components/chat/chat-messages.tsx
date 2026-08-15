import { type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ChatMessageBubble } from './chat-message-bubble'
import { useI18n } from '../../lib/i18n'
import type { ChatMessage } from '../../hooks/use-chat'

interface ToolStatus {
  name: string
  tool_use_id: string
}

interface ChatMessagesProps {
  messages: ChatMessage[]
  streaming: boolean
  thinking: boolean
  activeTool: ToolStatus | null
  error: string | null
  errorCategory?: string | null
  onRetry?: () => void
  debugEnabled?: boolean
  endRef?: RefObject<HTMLDivElement | null>
  showEndMarker?: boolean
}

export function ChatMessages({ messages, streaming, thinking, activeTool, error, onRetry, debugEnabled = false, endRef, showEndMarker }: ChatMessagesProps) {
  const { t, tError, isKeyNotSetError } = useI18n()

  return (
    <>
      {messages.map((msg, i) => (
        <ChatMessageBubble
          key={i}
          message={msg}
          streaming={streaming && i === messages.length - 1 && msg.role === 'assistant'}
          debugEnabled={debugEnabled}
          onRetry={onRetry}
          isLast={i === messages.length - 1}
        />
      ))}

      {activeTool && (
        <div className="flex flex-col gap-1.5 py-2 select-none animate-[fade-in_200ms_ease]">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-xs text-accent font-medium">
              {t('chat.toolRunning', { name: activeTool.name })}
            </span>
          </div>
          <div className="w-36 chat-thinking-bar" />
        </div>
      )}

      {thinking && !activeTool && (
        <div className="flex flex-col gap-1.5 py-2 select-none animate-[fade-in_200ms_ease]">
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-xs text-muted">{t('chat.thinking')}</span>
          </div>
          <div className="w-24 chat-thinking-bar" />
        </div>
      )}

      {error && (
        <div className="text-error text-xs py-1">
          {tError(error)}
          {isKeyNotSetError(error) && (
            <>
              <Link to="/settings/integration" className="underline text-accent">{t('error.goToSettings')}</Link>
              {t('error.setApiKeyFromSettings')}
            </>
          )}
        </div>
      )}

      {showEndMarker && <div ref={endRef} />}
    </>
  )
}
