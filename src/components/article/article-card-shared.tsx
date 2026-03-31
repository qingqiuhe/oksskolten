import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../lib/i18n'
import { isReadInSession } from '../../lib/readTracker'
import { extractDomain, articleUrlToPath } from '../../lib/url'
import { formatDate, formatRelativeDate } from '../../lib/dateFormat'
import type { ArticleListItem } from '../../../shared/types'

export function getArticleIconSrc(article: ArticleListItem, size: 16 | 32): string | null {
  if (article.feed_icon_url) return article.feed_icon_url
  const domain = extractDomain(article.url)
  return domain ? `https://www.google.com/s2/favicons?sz=${size}&domain=${domain}` : null
}

export function useCardBase(article: ArticleListItem, dateMode: 'relative' | 'absolute', onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void) {
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const isUnread = article.seen_at == null && !isReadInSession(article.id)
  const displayTitle = article.has_video && !article.title.trim() ? t('article.videoPost') : article.title
  const domain = extractDomain(article.url)
  const dateText = dateMode === 'relative'
    ? formatRelativeDate(article.published_at, locale, { justNow: t('date.justNow') })
    : formatDate(article.published_at, locale)
  const href = articleUrlToPath(article.url)

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) { onClick(e); return }
    if (e.metaKey || e.ctrlKey || e.button === 1) return
    e.preventDefault()
    void navigate(href)
  }

  return { isUnread, displayTitle, domain, dateText, href, handleClick, originalUrl: article.url }
}

export function ArticleKindBadge({ article }: { article: ArticleListItem }) {
  const { t } = useI18n()
  if (!article.article_kind) return null
  const labelKey = article.article_kind === 'original'
    ? 'articleKind.original'
    : article.article_kind === 'repost'
      ? 'articleKind.repost'
      : 'articleKind.quote'

  return (
    <span className="inline-flex shrink-0 rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
      {t(labelKey)}
    </span>
  )
}
