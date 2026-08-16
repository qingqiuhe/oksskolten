import { useState } from 'react'
import { ChevronDown, ChevronUp, Layers, Check, Bookmark } from 'lucide-react'
import type { SimilarGroup, SimilarArticleSummary } from '../../../shared/types'
import { articleUrlToPath } from '../../lib/url'
import { Link } from 'react-router-dom'

interface SimilarGroupProps {
  group: SimilarGroup
  onOpenOverlay?: (url: string) => void
  onToggleSeen?: (article: SimilarArticleSummary) => void
  onToggleBookmark?: (article: SimilarArticleSummary) => void
}

function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function SimilarGroupView({
  group,
  onOpenOverlay,
  onToggleSeen,
  onToggleBookmark,
}: SimilarGroupProps) {
  const [expanded, setExpanded] = useState(false)

  if (!group || group.count <= 1 || !group.articles || group.articles.length === 0) {
    return null
  }

  const otherCount = group.count - 1

  return (
    <div className="mt-2 border-t border-border/40 pt-2 text-xs">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setExpanded(prev => !prev)
        }}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-muted hover:text-text hover:bg-hover transition-colors font-medium select-none cursor-pointer"
        aria-expanded={expanded}
      >
        <Layers className="w-3.5 h-3.5 text-accent" />
        <span>
          {expanded ? 'Hide' : 'Show'} {otherCount} similar {otherCount === 1 ? 'story' : 'stories'}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 pl-4 border-l-2 border-accent/40 animate-[fade-in_150ms_ease]">
          {group.articles.map(article => {
            const isSeen = article.seen_at != null
            return (
              <div
                key={article.id}
                className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-hover/60 transition-colors group/item"
                onClick={(e) => {
                  if (onOpenOverlay) {
                    e.preventDefault()
                    e.stopPropagation()
                    onOpenOverlay(article.url)
                  }
                }}
              >
                <div className="min-w-0 flex-1 flex items-baseline gap-2">
                  <span className="text-[11px] text-muted font-medium shrink-0 truncate max-w-[120px]">
                    {article.feed_name}
                  </span>
                  <Link
                    to={articleUrlToPath(article.url)}
                    onClick={(e) => {
                      if (onOpenOverlay) {
                        e.preventDefault()
                        onOpenOverlay(article.url)
                      }
                    }}
                    className={`truncate text-xs ${isSeen ? 'text-muted' : 'text-text font-medium'} hover:text-accent transition-colors`}
                  >
                    {article.title}
                  </Link>
                </div>

                <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover/item:opacity-100">
                  <span className="text-[10px] text-muted mr-1">
                    {formatDate(article.published_at)}
                  </span>
                  {onToggleSeen && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onToggleSeen(article)
                      }}
                      className="p-1 hover:text-accent rounded transition-colors"
                      title={isSeen ? 'Mark unread' : 'Mark read'}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  )}
                  {onToggleBookmark && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onToggleBookmark(article)
                      }}
                      className="p-1 hover:text-accent rounded transition-colors"
                      title="Bookmark"
                    >
                      <Bookmark className={`w-3 h-3 ${article.bookmarked_at ? 'fill-current text-accent' : ''}`} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
