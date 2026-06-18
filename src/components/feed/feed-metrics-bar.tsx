import useSWR from 'swr'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import type { FeedWithCounts } from '../../../shared/types'

/** Number of days without new articles before a feed is considered stale */
const STALE_FEED_DAYS = 90

interface FeedMetricsBarProps {
  feed: FeedWithCounts
}

function formatRelativeDate(isoDate: string, locale: string): string {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24))
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' })
  if (days === 0) return rtf.format(0, 'day')
  if (days < 7) return rtf.format(-days, 'day')
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return rtf.format(-weeks, 'week')
  const months = Math.floor(days / 30)
  if (months < 12) return rtf.format(-months, 'month')
  const years = Math.floor(days / 365)
  return rtf.format(-years, 'year')
}

export function FeedMetricsBar({ feed }: FeedMetricsBarProps) {
  const { t, locale } = useI18n()
  const { data: metrics } = useSWR<{ avg_content_length: number | null }>(
    feed.article_count > 0 ? `/api/feeds/${feed.id}/metrics` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const isInactive = feed.article_count > 0 && (
    !feed.latest_published_at ||
    (Date.now() - new Date(feed.latest_published_at).getTime()) / (1000 * 60 * 60 * 24) >= STALE_FEED_DAYS
  )

  const parts: string[] = []

  parts.push(`${feed.article_count} ${t('metrics.articles')}`)

  const apw = feed.articles_per_week
  if (apw > 0) {
    parts.push(`${apw % 1 === 0 ? apw.toFixed(0) : apw.toFixed(1)}${t('metrics.perWeek')}`)
  }

  if (feed.latest_published_at) {
    parts.push(`${t('metrics.lastUpdated')}: ${formatRelativeDate(feed.latest_published_at, locale)}`)
  }

  if (metrics?.avg_content_length != null) {
    const avgLen = Math.round(metrics.avg_content_length)
    if (avgLen > 0) {
      const formatted = avgLen >= 1000
        ? `${(avgLen / 1000).toFixed(1)}k`
        : String(avgLen)
      parts.push(`avg ${formatted} ${t('metrics.chars')}`)
    }
  }

  return (
    <div className="flex items-center gap-1.5 px-4 md:px-6 py-2 text-[11px] text-muted select-none flex-wrap">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-0.5">·</span>}
          {part}
        </span>
      ))}
      {isInactive && (
        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' }}>
          {t('metrics.inactive')}
        </span>
      )}
    </div>
  )
}
