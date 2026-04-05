import { useRef } from 'react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Bookmark, Check } from 'lucide-react'
import { ArticleCard, type ArticleDisplayConfig } from './article-card'
import { articleUrlToPath } from '../../lib/url'
import type { ArticleListItem } from '../../../shared/types'
import type { LayoutName } from '../../data/layouts'
import type { FeedViewType } from '../../../shared/article-kind'

interface SwipeableArticleCardProps extends ArticleDisplayConfig {
  article: ArticleListItem
  layout?: LayoutName
  isFeatured?: boolean
  feedViewType?: FeedViewType
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
  onSwipeOpen?: (article: ArticleListItem) => void
  onSwipeMarkSeen?: (article: ArticleListItem) => void
  onSwipeBookmark?: (article: ArticleListItem) => void
}

const SWIPE_THRESHOLD = 80
const BOOKMARK_THRESHOLD = 160
const VELOCITY_THRESHOLD = 500

export type SwipeAction = 'open' | 'seen' | 'bookmark' | null

export function resolveSwipeAction(offsetX: number, velocityX: number): SwipeAction {
  if (offsetX <= -SWIPE_THRESHOLD || velocityX <= -VELOCITY_THRESHOLD) return 'open'
  if (offsetX >= BOOKMARK_THRESHOLD) return 'bookmark'
  if (offsetX >= SWIPE_THRESHOLD) return 'seen'
  return null
}

export function SwipeableArticleCard({
  article,
  layout,
  isFeatured,
  feedViewType,
  dateMode,
  indicatorStyle,
  showUnreadIndicator,
  showThumbnails,
  onClick: onClickProp,
  onSwipeOpen,
  onSwipeMarkSeen,
  onSwipeBookmark,
}: SwipeableArticleCardProps) {
  const navigate = useNavigate()
  const x = useMotionValue(0)
  const isDragging = useRef(false)

  const leftOpacity = useTransform(x, value => {
    if (value >= 0) return 0
    const opacity = Math.min(1, Math.abs(value) / SWIPE_THRESHOLD)
    return opacity
  })
  const rightSeenOpacity = useTransform(x, value => {
    if (value <= 0) return 0
    if (value >= BOOKMARK_THRESHOLD) return 0
    return Math.min(1, value / SWIPE_THRESHOLD)
  })
  const rightBookmarkOpacity = useTransform(x, value => {
    if (value <= SWIPE_THRESHOLD) return 0
    return Math.min(1, (value - SWIPE_THRESHOLD) / (BOOKMARK_THRESHOLD - SWIPE_THRESHOLD))
  })

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info
    isDragging.current = false

    const action = resolveSwipeAction(offset.x, velocity.x)
    if (action === 'open') {
      if (onSwipeOpen) onSwipeOpen(article)
      else void navigate(articleUrlToPath(article.url))
      return
    }
    if (action === 'bookmark') {
      onSwipeBookmark?.(article)
      return
    }
    if (action === 'seen') {
      onSwipeMarkSeen?.(article)
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle Cmd+Click, Ctrl+Click natively (open in new tab)
    if (e.metaKey || e.ctrlKey || e.button === 1) return
    e.preventDefault()
    // Only navigate if not dragging
    if (!isDragging.current) {
      if (onClickProp) { onClickProp(e) }
      else { void navigate(articleUrlToPath(article.url)) }
    }
  }

  return (
    <div className="relative overflow-hidden select-none touch-pan-y">
      {/* Left swipe background (open article) */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-end pr-6 bg-accent/15"
        style={{ opacity: leftOpacity }}
      >
        <ArrowRight className="w-5 h-5 text-accent" />
      </motion.div>

      {/* Right swipe short background (mark seen) */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-start pl-6 bg-emerald-500/12"
        style={{ opacity: rightSeenOpacity }}
      >
        <Check className="w-5 h-5 text-emerald-600" />
      </motion.div>

      {/* Right swipe long background (bookmark) */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-start pl-6 bg-amber-500/12"
        style={{ opacity: rightBookmarkOpacity }}
      >
        <Bookmark className="w-5 h-5 text-amber-600" />
      </motion.div>

      {/* Draggable card */}
      <motion.div
        style={{ x }}
        drag="x"
        dragConstraints={{ left: -BOOKMARK_THRESHOLD, right: BOOKMARK_THRESHOLD }}
        dragSnapToOrigin
        dragElastic={0.35}
        onDragStart={() => { isDragging.current = true }}
        onDragEnd={handleDragEnd}
        className="relative bg-bg"
      >
        <ArticleCard
          article={article}
          layout={layout}
          isFeatured={isFeatured}
          feedViewType={feedViewType}
          dateMode={dateMode}
          indicatorStyle={indicatorStyle}
          showUnreadIndicator={showUnreadIndicator}
          showThumbnails={showThumbnails}
          onClick={handleClick}
        />
      </motion.div>
    </div>
  )
}
