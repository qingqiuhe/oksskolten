import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiPost, ApiError, fetcher } from '../../lib/fetcher'
import { normalizeFeedIconUrl, isValidFeedIconUrl } from '../../lib/feed-icon-url'
import { useI18n } from '../../lib/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { FeedIconPreview } from './feed-icon-preview'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { Category } from '../../../shared/types'
import { buildRssHubTwitterUserUrl, parseXAccountInput } from '../../../shared/social-sources'

interface SocialFeedStepProps {
  onClose: () => void
  onCreated: () => void
  onFetchStarted?: (feedId: number) => void
  categories: Category[]
}

function localizeSocialFeedError(raw: string, t: ReturnType<typeof useI18n>['t']): string {
  if (!raw) return t('modal.genericError')
  if (raw.includes('already exists')) return t('modal.errorAlreadyExists')
  if (raw.includes('https://')) return t('modal.errorHttpsOnly')
  if (raw.includes('RSSHub instance is not configured')) return t('socialFeed.rsshubNotConfigured')
  if (raw.includes('Enter an X handle or profile URL')) return t('socialFeed.invalidXInput')
  return raw
}

export function SocialFeedStep({ onClose, onCreated, onFetchStarted, categories }: SocialFeedStepProps) {
  const { t } = useI18n()
  const { data } = useSWR<{ rsshub_base_url: string }>('/api/settings/social-sources', fetcher)
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [iconUrl, setIconUrl] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [priorityLevel, setPriorityLevel] = useState<'1' | '2' | '3' | '4' | '5'>('3')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const parsed = useMemo(() => parseXAccountInput(input), [input])
  const rsshubBaseUrl = data?.rsshub_base_url?.trim() ?? ''
  const rssPreviewUrl = parsed && rsshubBaseUrl ? buildRssHubTwitterUserUrl(rsshubBaseUrl, parsed.handle) : ''
  const canCreate = Boolean(parsed) && Boolean(rsshubBaseUrl) && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const normalizedIconUrl = normalizeFeedIconUrl(iconUrl)
    if (normalizedIconUrl && !isValidFeedIconUrl(normalizedIconUrl)) {
      setError(t('feeds.avatarUrlInvalid'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const result = await apiPost('/api/feeds/social', {
        platform: 'x',
        input: input.trim(),
        name: name.trim() || undefined,
        icon_url: normalizedIconUrl ?? undefined,
        category_id: categoryId || null,
        priority_level: Number(priorityLevel),
      }) as { feed?: { id: number } }
      onCreated()
      if (result.feed?.id != null) onFetchStarted?.(result.feed.id)
      onClose()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : '')
      setError(localizeSocialFeedError(message, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted" htmlFor="social-x-input">
          {t('socialFeed.xInputLabel')}
        </label>
        <Input
          id="social-x-input"
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (error) setError(null)
          }}
          placeholder="@elonmusk"
          autoFocus
          required
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-bg-subtle px-3 py-2">
        <div>
          <p className="text-xs font-medium text-muted">{t('socialFeed.profilePreview')}</p>
          <p className="text-sm break-all text-text">{parsed?.profileUrl ?? t('socialFeed.previewPending')}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted">{t('socialFeed.feedPreview')}</p>
          <p className="text-sm break-all text-text">
            {rssPreviewUrl || (rsshubBaseUrl ? t('socialFeed.previewPending') : t('socialFeed.rsshubNotConfigured'))}
          </p>
        </div>
      </div>

      {!rsshubBaseUrl && (
        <p className="text-xs text-error">{t('socialFeed.rsshubNotConfigured')}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted" htmlFor="social-feed-name">
            {t('jsonApi.feedName')}
          </label>
          <Input
            id="social-feed-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('socialFeed.namePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted" htmlFor="social-feed-icon-url">
            {t('feeds.avatarUrl')}
          </label>
          <Input
            id="social-feed-icon-url"
            type="url"
            value={iconUrl}
            onChange={(e) => {
              setIconUrl(e.target.value)
              if (error) setError(null)
            }}
            placeholder={t('feeds.avatarUrlPlaceholder')}
          />
        </div>
      </div>

      <FeedIconPreview iconUrl={normalizeFeedIconUrl(iconUrl)} feedUrl={parsed?.profileUrl ?? ''} name={name || (parsed ? `@${parsed.handle}` : '')} />

      {categories.length > 0 && (
        <Select value={categoryId === '' ? '__none__' : String(categoryId)} onValueChange={v => setCategoryId(v === '__none__' ? '' : Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t('category.uncategorized')}</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted" htmlFor="social-feed-priority">
          {t('feeds.priority.label')}
        </label>
        <Select value={priorityLevel} onValueChange={(value) => setPriorityLevel(value as typeof priorityLevel)}>
          <SelectTrigger id="social-feed-priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">{t('feeds.priority.ignore')}</SelectItem>
            <SelectItem value="2">{t('feeds.priority.low')}</SelectItem>
            <SelectItem value="3">{t('feeds.priority.medium')}</SelectItem>
            <SelectItem value="4">{t('feeds.priority.high')}</SelectItem>
            <SelectItem value="5">{t('feeds.priority.mustRead')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-xs text-error">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('modal.cancel')}
        </Button>
        <Button type="submit" disabled={!canCreate}>
          {submitting ? t('modal.adding') : t('modal.add')}
        </Button>
      </div>
    </form>
  )
}
