import type { ReactNode } from 'react'
import { Sparkles, CalendarDays, Layers3, Clock3 } from 'lucide-react'
import type { InboxSummary } from '../../../shared/types'

export type InboxSort = 'newest' | 'oldest_unread' | 'score'
export type InboxGroupMode = 'none' | 'day' | 'feed'

interface InboxHeaderProps {
  summary?: InboxSummary
  sort: InboxSort
  groupMode: InboxGroupMode
  onSortChange: (sort: InboxSort) => void
  onGroupModeChange: (mode: InboxGroupMode) => void
  chatTrigger: ReactNode
  labels: {
    unreadTotal: string
    newToday: string
    oldestUnread: string
    sourceCount: string
    latest: string
    backlog: string
    highValue: string
    groupNone: string
    groupDay: string
    groupFeed: string
    noUnread: string
  }
}

function SummaryChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-subtle px-3 py-1.5 text-xs text-muted">
      <span className="text-muted">{icon}</span>
      <span>{label}</span>
      <span className="font-medium text-text">{value}</span>
    </div>
  )
}

function SortButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? 'border-accent bg-accent text-accent-text'
          : 'border-border bg-bg text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function InboxHeader({
  summary,
  sort,
  groupMode,
  onSortChange,
  onGroupModeChange,
  chatTrigger,
  labels,
}: InboxHeaderProps) {
  return (
    <section className="px-4 md:px-6 py-4 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label={labels.unreadTotal}
          value={String(summary?.unread_total ?? 0)}
        />
        <SummaryChip
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          label={labels.newToday}
          value={String(summary?.new_today ?? 0)}
        />
        <SummaryChip
          icon={<Clock3 className="h-3.5 w-3.5" />}
          label={labels.oldestUnread}
          value={summary?.oldest_unread_at ? formatDate(summary.oldest_unread_at) : labels.noUnread}
        />
        <SummaryChip
          icon={<Layers3 className="h-3.5 w-3.5" />}
          label={labels.sourceCount}
          value={String(summary?.source_feed_count ?? 0)}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SortButton active={sort === 'newest'} label={labels.latest} onClick={() => onSortChange('newest')} />
            <SortButton active={sort === 'oldest_unread'} label={labels.backlog} onClick={() => onSortChange('oldest_unread')} />
            <SortButton active={sort === 'score'} label={labels.highValue} onClick={() => onSortChange('score')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SortButton active={groupMode === 'none'} label={labels.groupNone} onClick={() => onGroupModeChange('none')} />
            <SortButton active={groupMode === 'day'} label={labels.groupDay} onClick={() => onGroupModeChange('day')} />
            <SortButton active={groupMode === 'feed'} label={labels.groupFeed} onClick={() => onGroupModeChange('feed')} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {chatTrigger}
        </div>
      </div>
    </section>
  )
}
