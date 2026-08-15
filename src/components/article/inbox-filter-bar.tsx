import { useState } from 'react'
import { Filter, X, Check, ChevronDown, ChevronUp } from 'lucide-react'

export type TimeRangeFilter = 'all' | 'today' | 'week' | '3days'

export interface InboxFilters {
  feedIds: number[]
  timeRange: TimeRangeFilter
  includeBookmarked: boolean
  includeLiked: boolean
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  feedIds: [],
  timeRange: 'all',
  includeBookmarked: false,
  includeLiked: false,
}

interface InboxFilterBarProps {
  feeds: Array<{ id: number; name: string }>
  filters: InboxFilters
  onChange: (filters: InboxFilters) => void
}

export function InboxFilterBar({ feeds, filters, onChange }: InboxFilterBarProps) {
  const [open, setOpen] = useState(false)

  const activeCount =
    filters.feedIds.length +
    (filters.timeRange !== 'all' ? 1 : 0) +
    (filters.includeBookmarked ? 1 : 0) +
    (filters.includeLiked ? 1 : 0)

  const handleToggleFeed = (id: number) => {
    const next = filters.feedIds.includes(id)
      ? filters.feedIds.filter(fId => fId !== id)
      : [...filters.feedIds, id]
    onChange({ ...filters, feedIds: next })
  }

  const handleReset = () => {
    onChange({ ...DEFAULT_INBOX_FILTERS })
  }

  return (
    <div className="border-b border-border bg-bg-subtle/50 px-4 md:px-6 py-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-text py-1 transition-colors"
          aria-expanded={open}
        >
          <Filter className="w-3.5 h-3.5" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-accent text-accent-text">
              {activeCount}
            </span>
          )}
          {open ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-error transition-colors"
          >
            <X className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-border/60 space-y-3 animate-[fade-in_150ms_ease]">
          {/* Time range */}
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider block mb-1.5">
              Time Range
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'today', '3days', 'week'] as const).map(range => (
                <button
                  key={range}
                  type="button"
                  onClick={() => onChange({ ...filters, timeRange: range })}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    filters.timeRange === range
                      ? 'border-accent bg-accent text-accent-text font-medium'
                      : 'border-border bg-bg text-muted hover:text-text'
                  }`}
                >
                  {range === 'all' && 'All Time'}
                  {range === 'today' && 'Today'}
                  {range === '3days' && 'Last 3 Days'}
                  {range === 'week' && 'This Week'}
                </button>
              ))}
            </div>
          </div>

          {/* Quick flags */}
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider block mb-1.5">
              Include
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ ...filters, includeBookmarked: !filters.includeBookmarked })}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  filters.includeBookmarked
                    ? 'border-accent bg-accent text-accent-text font-medium'
                    : 'border-border bg-bg text-muted hover:text-text'
                }`}
              >
                {filters.includeBookmarked && <Check className="w-3 h-3" />}
                Bookmarked
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...filters, includeLiked: !filters.includeLiked })}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  filters.includeLiked
                    ? 'border-accent bg-accent text-accent-text font-medium'
                    : 'border-border bg-bg text-muted hover:text-text'
                }`}
              >
                {filters.includeLiked && <Check className="w-3 h-3" />}
                Liked
              </button>
            </div>
          </div>

          {/* Feeds multi-select */}
          {feeds.length > 0 && (
            <div>
              <span className="text-[11px] font-medium text-muted uppercase tracking-wider block mb-1.5">
                Feeds ({filters.feedIds.length ? `${filters.feedIds.length} selected` : 'all'})
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                {feeds.map(feed => {
                  const isSelected = filters.feedIds.includes(feed.id)
                  return (
                    <button
                      key={feed.id}
                      type="button"
                      onClick={() => handleToggleFeed(feed.id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors truncate max-w-[200px] ${
                        isSelected
                          ? 'border-accent bg-accent text-accent-text font-medium'
                          : 'border-border bg-bg text-muted hover:text-text'
                      }`}
                      title={feed.name}
                    >
                      {isSelected && <Check className="w-3 h-3 shrink-0" />}
                      <span className="truncate">{feed.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
