import { useMemo, useState } from 'react'
import { apiPost, ApiError } from '../../lib/fetcher'
import { normalizeFeedIconUrl, isValidFeedIconUrl } from '../../lib/feed-icon-url'
import { useI18n } from '../../lib/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { FeedIconPreview } from './feed-icon-preview'
import {
  ALIGNED_NEWS_EXAMPLE,
  JSON_API_TEMPLATE,
  JsonApiSourceEditor,
  type JsonApiPreviewResponse,
} from './json-api-source-editor'
import type { Category } from '../../../shared/types'

interface JsonApiFeedStepProps {
  onClose: () => void
  onCreated: () => void
  onFetchStarted?: (feedId: number) => void
  categories: Category[]
}

function getPreviewKey(url: string, script: string, viewType: 'auto' | 'article' | 'social'): string {
  return JSON.stringify([url.trim(), script, viewType])
}

function localizeJsonApiError(raw: string, t: ReturnType<typeof useI18n>['t']): string {
  if (!raw) return t('modal.genericError')
  if (raw.includes('already exists')) return t('modal.errorAlreadyExists')
  if (raw.includes('https://')) return t('modal.errorHttpsOnly')
  if (raw.includes('transform_script')) return t('jsonApi.invalidTransform')
  return raw
}

export function JsonApiFeedStep({ onClose, onCreated, onFetchStarted, categories }: JsonApiFeedStepProps) {
  const { t } = useI18n()
  const [endpointUrl, setEndpointUrl] = useState('')
  const [transformScript, setTransformScript] = useState(ALIGNED_NEWS_EXAMPLE)
  const [name, setName] = useState('')
  const [iconUrl, setIconUrl] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [viewType, setViewType] = useState<'auto' | 'article' | 'social'>('auto')
  const [preview, setPreview] = useState<JsonApiPreviewResponse | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const currentPreviewKey = useMemo(
    () => getPreviewKey(endpointUrl, transformScript, viewType),
    [endpointUrl, transformScript, viewType],
  )
  const previewDirty = preview != null && previewKey !== currentPreviewKey
  const canCreate = !!preview && !previewDirty && !submitting

  async function handlePreview() {
    setPreviewLoading(true)
    setPreviewError(null)
    setSubmitError(null)
    try {
      const result = await apiPost('/api/feeds/json-api/preview', {
        url: endpointUrl.trim(),
        name: name.trim() || undefined,
        icon_url: normalizeFeedIconUrl(iconUrl) ?? undefined,
        category_id: categoryId || null,
        view_type: viewType === 'auto' ? null : viewType,
        transform_script: transformScript,
      }) as JsonApiPreviewResponse
      setPreview(result)
      setPreviewKey(currentPreviewKey)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : '')
      setPreviewError(localizeJsonApiError(message, t))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const normalizedIconUrl = normalizeFeedIconUrl(iconUrl)
    if (normalizedIconUrl && !isValidFeedIconUrl(normalizedIconUrl)) {
      setSubmitError(t('feeds.avatarUrlInvalid'))
      return
    }
    if (!canCreate) {
      setSubmitError(t('jsonApi.previewRequired'))
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await apiPost('/api/feeds/json-api', {
        url: endpointUrl.trim(),
        name: name.trim() || undefined,
        icon_url: normalizedIconUrl ?? undefined,
        category_id: categoryId || null,
        view_type: viewType === 'auto' ? null : viewType,
        transform_script: transformScript,
      }) as { feed?: { id: number } }
      onCreated()
      if (result.feed?.id != null) {
        onFetchStarted?.(result.feed.id)
      }
      onClose()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : '')
      setSubmitError(localizeJsonApiError(message, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <JsonApiSourceEditor
        endpointUrl={endpointUrl}
        transformScript={transformScript}
        onEndpointUrlChange={(value) => {
          setEndpointUrl(value)
          setPreviewError(null)
        }}
        onTransformScriptChange={(value) => {
          setTransformScript(value)
          setPreviewError(null)
        }}
        viewType={viewType}
        onViewTypeChange={(value) => setViewType(value)}
        preview={preview}
        previewError={previewError}
        previewLoading={previewLoading}
        previewDirty={previewDirty}
        onPreview={() => { void handlePreview() }}
        onLoadTemplate={() => setTransformScript(JSON_API_TEMPLATE)}
        onLoadExample={() => setTransformScript(ALIGNED_NEWS_EXAMPLE)}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted" htmlFor="json-api-feed-name">
            {t('jsonApi.feedName')}
          </label>
          <Input
            id="json-api-feed-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('jsonApi.namePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted" htmlFor="json-api-feed-icon-url">
            {t('feeds.avatarUrl')}
          </label>
          <Input
            id="json-api-feed-icon-url"
            type="url"
            value={iconUrl}
            onChange={e => {
              setIconUrl(e.target.value)
              setSubmitError(null)
            }}
            placeholder={t('feeds.avatarUrlPlaceholder')}
          />
        </div>
      </div>

      <FeedIconPreview iconUrl={normalizeFeedIconUrl(iconUrl)} feedUrl={endpointUrl.trim()} name={name || preview?.resolved_feed.name || ''} />

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

      {submitError && <p className="text-xs text-error">{submitError}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('modal.cancel')}
        </Button>
        <Button type="submit" disabled={!canCreate}>
          {submitting ? t('modal.adding') : t('jsonApi.create')}
        </Button>
      </div>
    </form>
  )
}
