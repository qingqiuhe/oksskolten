import { Check, Bookmark, X, CheckSquare } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

interface InboxSelectionBarProps {
  selectedCount: number
  totalVisibleCount: number
  onSelectAllVisible: () => void
  onDeselectAll: () => void
  onBatchMarkSeen: () => void
  onBatchBookmark: () => void
  onCancel: () => void
  loading?: boolean
}

export function InboxSelectionBar({
  selectedCount,
  totalVisibleCount,
  onSelectAllVisible,
  onDeselectAll,
  onBatchMarkSeen,
  onBatchBookmark,
  onCancel,
  loading = false,
}: InboxSelectionBarProps) {
  const { t } = useI18n()

  const allVisibleSelected = totalVisibleCount > 0 && selectedCount === totalVisibleCount

  return (
    <div className="fixed bottom-6 inset-x-0 mx-auto max-w-xl px-4 z-40 pointer-events-auto animate-[slide-up_200ms_ease]">
      <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border border-border bg-bg/95 backdrop-blur shadow-xl">
        <div className="flex items-center gap-2 pl-2">
          <span className="text-xs font-semibold text-text">
            {selectedCount} selected
          </span>

          <button
            type="button"
            onClick={allVisibleSelected ? onDeselectAll : onSelectAllVisible}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-muted hover:text-text hover:bg-hover transition-colors"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>{allVisibleSelected ? 'Deselect all' : 'Select visible'}</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBatchMarkSeen}
            disabled={selectedCount === 0 || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-bg-subtle hover:bg-bg-hover text-text border border-border transition-colors disabled:opacity-40 select-none cursor-pointer"
            title="Mark selected as read"
          >
            <Check className="w-3.5 h-3.5 text-accent" />
            <span>{t('inbox.markRead')}</span>
          </button>

          <button
            type="button"
            onClick={onBatchBookmark}
            disabled={selectedCount === 0 || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-40 select-none cursor-pointer"
            title="Bookmark selected"
          >
            <Bookmark className="w-3.5 h-3.5 fill-current" />
            <span>{t('article.addBookmark')}</span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 text-muted hover:text-text hover:bg-hover rounded-lg transition-colors ml-1"
            title="Cancel selection"
            aria-label="Cancel selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
