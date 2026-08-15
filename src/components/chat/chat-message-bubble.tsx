import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import { renderMarkdown, walkLinks } from '../../lib/markdown'
import { sanitizeHtml } from '../../lib/sanitize'
import { SanitizedHTML } from '../ui/sanitized-html'
import type { ChatMessage } from '../../hooks/use-chat'
import { getModelLabel, getModelPricing } from '../../../shared/models'
import { useI18n } from '../../lib/i18n'
import { articleUrlToPath } from '../../lib/url'
import { ChatDebugPanel } from './chat-debug-panel'

interface ChatMessageBubbleProps {
  message: ChatMessage
  streaming?: boolean
  debugEnabled?: boolean
  onRetry?: () => void
  isLast?: boolean
}

/**
 * Convert external URLs in markdown links to in-app paths.
 * e.g. [title](https://example.com/article) → [title](/example.com/article)
 */
function rewriteLinksToAppPaths(md: string): string {
  return walkLinks(md, (text, url) => {
    if (/^https?:\/\//.test(url)) {
      return `[${text}](${articleUrlToPath(url)})`
    }
    return null
  })
}

function formatToolSummary(summary: NonNullable<ChatMessage['toolSummary']>): string {
  return summary.map(item => `${item.name} ×${item.count}`).join(' · ')
}

function formatChatUsage(usage: NonNullable<ChatMessage['usage']>): string {
  const modelId = usage.model ?? ''
  const modelLabel = getModelLabel(modelId) ?? modelId
  const elapsed = (usage.elapsed_ms / 1000).toFixed(1)
  const [inputRate, outputRate] = getModelPricing(modelId) ?? [1, 5]
  const cost = (usage.input_tokens * inputRate + usage.output_tokens * outputRate) / 1_000_000
  return `${modelLabel} · ${elapsed}s · ${usage.input_tokens.toLocaleString()} in · ${usage.output_tokens.toLocaleString()} out · ~$${cost.toFixed(4)}`
}

export function ChatMessageBubble({ message, streaming, debugEnabled = false, onRetry, isLast }: ChatMessageBubbleProps) {
  const { t } = useI18n()
  const html = useMemo(() => {
    if (!message.text) return ''
    return sanitizeHtml(renderMarkdown(message.text, [rewriteLinksToAppPaths]))
  }, [message.text])

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2 bg-accent text-accent-text text-sm">
          {message.text}
        </div>
      </div>
    )
  }

  const isFailedOrInterrupted = message.status === 'interrupted' || message.status === 'error' || Boolean(message.errorMessage)

  return (
    <div className="pb-4">
        {html ? (
          <SanitizedHTML html={html} className="chat-markdown text-sm" />
        ) : streaming ? (
          <div className="flex items-center gap-1.5 py-2">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        ) : null}
        {message.usage && !streaming && (
          <p className="text-[11px] text-muted mt-1 select-none">
            {formatChatUsage(message.usage)}
          </p>
        )}
        {message.toolSummary && message.toolSummary.length > 0 && !streaming && (
          <p className="text-[11px] text-muted mt-0.5 select-none">
            {formatToolSummary(message.toolSummary)}
          </p>
        )}
        {message.status === 'interrupted' && !streaming && (
          <p className="text-[11px] text-warning mt-1 select-none">
            {t('chat.turnInterrupted')}
          </p>
        )}
        {message.status === 'error' && !streaming && (
          <p className="text-[11px] text-error mt-1 select-none">
            {message.errorMessage || t('chat.turnFailed')}
          </p>
        )}
        {isLast && !streaming && isFailedOrInterrupted && onRetry && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-bg-subtle hover:bg-bg-hover text-text border border-border transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              {t('chat.retry')}
            </button>
          </div>
        )}
        {debugEnabled && message.debugTrace && !streaming && (
          <ChatDebugPanel trace={message.debugTrace} />
        )}
    </div>
  )
}