import { useEffect, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { getFeedIconPreviewSrc } from '../../lib/feed-icon-url'
import { useI18n } from '../../lib/i18n'

interface FeedIconPreviewProps {
  iconUrl: string | null | undefined
  feedUrl: string
  name: string
}

export function FeedIconPreview({ iconUrl, feedUrl, name }: FeedIconPreviewProps) {
  const { t } = useI18n()
  const src = getFeedIconPreviewSrc(iconUrl, feedUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-subtle px-3 py-2">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-bg">
        {src && !failed ? (
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <ImageIcon size={18} strokeWidth={1.5} className="text-muted" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted">{t('feeds.avatarPreview')}</p>
        <p className="truncate text-sm text-text">{name.trim() || feedUrl.trim() || t('feeds.editFeed')}</p>
      </div>
    </div>
  )
}
