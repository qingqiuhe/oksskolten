import type { ReactNode } from 'react'
import { Bookmark, Check, ExternalLink, Heart, RotateCcw } from 'lucide-react'

interface ArticleInlineActionsProps {
  isSeen: boolean
  isBookmarked: boolean
  isLiked: boolean
  isTouchDevice: boolean
  onToggleSeen: () => void
  onToggleBookmark: () => void
  onToggleLike: () => void
  onOpenOverlay: () => void
  labels: {
    markRead: string
    markUnread: string
    bookmark: string
    unbookmark: string
    like: string
    unlike: string
    openOverlay: string
  }
}

function ActionButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg/95 text-muted shadow-sm backdrop-blur transition hover:text-text ${
        active ? 'text-accent border-accent/40' : ''
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

export function ArticleInlineActions({
  isSeen,
  isBookmarked,
  isLiked,
  isTouchDevice,
  onToggleSeen,
  onToggleBookmark,
  onToggleLike,
  onOpenOverlay,
  labels,
}: ArticleInlineActionsProps) {
  return (
    <div
      className={isTouchDevice
        ? 'mt-2 flex items-center justify-end gap-2 px-4 md:px-6'
        : 'pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100'}
    >
      <div className={isTouchDevice ? 'pointer-events-auto flex items-center gap-2' : 'pointer-events-auto flex items-center gap-2'}>
        <ActionButton
          label={isSeen ? labels.markUnread : labels.markRead}
          active={isSeen}
          onClick={onToggleSeen}
        >
          {isSeen ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        </ActionButton>
        <ActionButton
          label={isBookmarked ? labels.unbookmark : labels.bookmark}
          active={isBookmarked}
          onClick={onToggleBookmark}
        >
          <Bookmark className={`h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
        </ActionButton>
        <ActionButton
          label={isLiked ? labels.unlike : labels.like}
          active={isLiked}
          onClick={onToggleLike}
        >
          <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
        </ActionButton>
        <ActionButton
          label={labels.openOverlay}
          onClick={onOpenOverlay}
        >
          <ExternalLink className="h-4 w-4" />
        </ActionButton>
      </div>
    </div>
  )
}
