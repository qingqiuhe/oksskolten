import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { formatRelativeDate } from '../../lib/dateFormat'
import { extractXHandle } from '../../../shared/article-kind'
import type { ArticleListItem } from '../../../shared/types'
import { ArticleKindBadge, getArticleIconSrc, useCardBase } from './article-card-shared'

interface SocialCardProps {
  article: ArticleListItem
  dateMode: 'relative' | 'absolute'
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
}

function SocialAvatar({ article }: { article: ArticleListItem }) {
  const [failed, setFailed] = useState(false)
  const iconSrc = article.feed_icon_url || getArticleIconSrc(article, 32)

  if (iconSrc && !failed) {
    return (
      <img
        src={iconSrc}
        alt=""
        loading="lazy"
        className="h-9 w-9 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }

  return <div className="h-9 w-9 shrink-0 rounded-full bg-border/40" />
}

export function SocialCard({ article, dateMode, onClick }: SocialCardProps) {
  const { locale, t } = useI18n()
  const { isUnread, displayTitle, href, handleClick, originalUrl } = useCardBase(article, dateMode, onClick)
  const handle = extractXHandle(article.url)
  const dateText = formatRelativeDate(article.published_at, locale, { justNow: t('date.justNow') })
  const bodyText = article.excerpt?.trim() || displayTitle

  return (
    <a
      href={href}
      data-original-url={originalUrl}
      onClick={handleClick}
      className={`article-card block border-b border-border px-4 py-3 text-inherit no-underline transition-[background-color,transform,box-shadow] duration-100 hover:bg-hover hover:-translate-y-px hover:shadow-sm md:px-6 ${
        isUnread ? 'bg-accent/5' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <SocialAvatar article={article} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[15px] ${isUnread ? 'font-semibold text-text' : 'font-medium text-text'}`}>
              {article.feed_name}
            </span>
            {handle && <span className="text-[13px] text-muted">{handle}</span>}
            {dateText && <span className="text-[13px] text-muted">{dateText}</span>}
            {article.article_kind && article.article_kind !== 'original' && <ArticleKindBadge article={article} />}
          </div>

          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-text">
            {bodyText}
          </p>

          {article.og_image && (
            <img
              src={article.og_image}
              alt=""
              loading="lazy"
              className="mt-3 aspect-[16/10] w-full rounded-2xl border border-border object-cover"
            />
          )}
        </div>
      </div>
    </a>
  )
}
