import { useI18n } from '../../lib/i18n'
import { formatScopeSummaryDetail } from '../../lib/chat-scope'
import type { ScopeSummary } from '../../../shared/types'

interface ChatScopeBadgeProps {
  summary: ScopeSummary | null | undefined
}

export function ChatScopeBadge({ summary }: ChatScopeBadgeProps) {
  const { t } = useI18n()
  if (!summary) return null
  const detailText = formatScopeSummaryDetail(summary, t)

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="inline-flex items-center rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] text-muted shrink-0">
        {summary.label}
      </span>
      {detailText && (
        <span className="text-xs text-muted truncate">
          {detailText}
        </span>
      )}
    </div>
  )
}
