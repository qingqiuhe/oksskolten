import Editor from 'react-simple-code-editor'
import hljs from 'highlight.js/lib/core'
import javascriptLang from 'highlight.js/lib/languages/javascript'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useI18n } from '../../lib/i18n'
import { extractDomain } from '../../lib/url'

hljs.registerLanguage('javascript', javascriptLang)

export interface JsonApiPreviewItem {
  url: string
  title: string
  published_at: string | null
  excerpt: string | null
}

export interface JsonApiPreviewResponse {
  resolved_feed: {
    name: string
    icon_url: string | null
    view_type: 'article' | 'social' | null
  }
  sample_items: JsonApiPreviewItem[]
  warnings: string[]
  stats: {
    received_count: number
    accepted_count: number
    dropped_count: number
  }
}

export const JSON_API_TEMPLATE = `({ response }) => {
  if (!Array.isArray(response)) return []

  return response.map(item => ({
    url: item.url,
    title: item.title,
    published_at: item.published_at,
    excerpt: item.summary,
    content_text: item.body,
    og_image: item.image_url,
  }))
}`

export const ALIGNED_NEWS_EXAMPLE = `({ response }) => {
  if (!Array.isArray(response)) return []

  return response.map(story => ({
    url: story.source_url,
    title: story.headline,
    published_at: story.published_at,
    excerpt: story.summary,
    content_text: story.body ?? story.summary,
  }))
}`

interface JsonApiSourceEditorProps {
  endpointUrl: string
  endpointReadOnly?: boolean
  transformScript: string
  onEndpointUrlChange?: (value: string) => void
  onTransformScriptChange: (value: string) => void
  viewType: 'auto' | 'article' | 'social'
  onViewTypeChange?: (value: 'auto' | 'article' | 'social') => void
  preview: JsonApiPreviewResponse | null
  previewError: string | null
  previewLoading: boolean
  previewDirty: boolean
  onPreview: () => void
  onLoadTemplate?: () => void
  onLoadExample?: () => void
}

function renderCode(code: string): string {
  const source = code.trim() || JSON_API_TEMPLATE
  const html = hljs.highlight(source, { language: 'javascript' }).value
  return code.trim() ? html : `<span class="text-muted opacity-40">${html}</span>`
}

export function JsonApiSourceEditor({
  endpointUrl,
  endpointReadOnly = false,
  transformScript,
  onEndpointUrlChange,
  onTransformScriptChange,
  viewType,
  onViewTypeChange,
  preview,
  previewError,
  previewLoading,
  previewDirty,
  onPreview,
  onLoadTemplate,
  onLoadExample,
}: JsonApiSourceEditorProps) {
  const { t } = useI18n()
  const canPreview = endpointUrl.trim().length > 0 && transformScript.trim().length > 0 && !previewLoading

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted" htmlFor="json-api-endpoint-url">
          {t('jsonApi.endpointUrl')}
        </label>
        {endpointReadOnly ? (
          <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-muted break-all">
            {endpointUrl}
          </div>
        ) : (
          <Input
            id="json-api-endpoint-url"
            type="url"
            value={endpointUrl}
            onChange={e => onEndpointUrlChange?.(e.target.value)}
            placeholder="https://example.com/api/stories"
            required
          />
        )}
      </div>

      {onViewTypeChange && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted" htmlFor="json-api-view-type">
            {t('feeds.viewAs')}
          </label>
          <Select value={viewType} onValueChange={value => onViewTypeChange(value as 'auto' | 'article' | 'social')}>
            <SelectTrigger id="json-api-view-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('feeds.viewType.auto')}</SelectItem>
              <SelectItem value="article">{t('feeds.viewType.article')}</SelectItem>
              <SelectItem value="social">{t('feeds.viewType.social')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-muted" htmlFor="json-api-transform-script">
            {t('jsonApi.transformScript')}
          </label>
          <div className="flex items-center gap-2">
            {onLoadTemplate && (
              <Button type="button" size="sm" variant="outline" onClick={onLoadTemplate}>
                {t('jsonApi.useTemplate')}
              </Button>
            )}
            {onLoadExample && (
              <Button type="button" size="sm" variant="outline" onClick={onLoadExample}>
                {t('jsonApi.useAlignedNewsExample')}
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border bg-bg-input overflow-auto h-64 sm:h-72">
          <Editor
            value={transformScript}
            onValueChange={onTransformScriptChange}
            highlight={renderCode}
            padding={12}
            className="text-xs font-mono text-text min-h-full"
            textareaClassName="theme-json-editor-textarea"
            style={{ minHeight: '100%' }}
          />
        </div>

        <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-muted space-y-1">
          <p>{t('jsonApi.contractTitle')}</p>
          <p><code>{t('jsonApi.contractInput')}</code></p>
          <p><code>{t('jsonApi.contractOutput')}</code></p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted">
          {preview && previewDirty ? t('jsonApi.previewStale') : preview ? t('jsonApi.previewReady') : t('jsonApi.previewRequired')}
        </div>
        <Button type="button" onClick={onPreview} disabled={!canPreview}>
          {previewLoading ? t('jsonApi.previewing') : t('jsonApi.preview')}
        </Button>
      </div>

      {previewError && (
        <p className="text-xs text-error">{previewError}</p>
      )}

      {preview && (
        <div className="rounded-xl border border-border bg-bg-subtle p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted">{t('jsonApi.resolvedFeed')}</p>
              <p className="text-sm text-text">{preview.resolved_feed.name}</p>
              <p className="text-xs text-muted">
                {preview.resolved_feed.view_type === 'social'
                  ? t('feeds.viewType.social')
                  : preview.resolved_feed.view_type === 'article'
                    ? t('feeds.viewType.article')
                    : t('feeds.viewType.auto')}
              </p>
            </div>
            <div className="text-xs text-muted text-right">
              <p>{t('jsonApi.statsReceived', { count: String(preview.stats.received_count) })}</p>
              <p>{t('jsonApi.statsAccepted', { count: String(preview.stats.accepted_count) })}</p>
              {preview.stats.dropped_count > 0 && (
                <p>{t('jsonApi.statsDropped', { count: String(preview.stats.dropped_count) })}</p>
              )}
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">{t('jsonApi.warnings')}</p>
              <ul className="space-y-1">
                {preview.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`} className="text-xs text-warning">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">{t('jsonApi.sampleItems')}</p>
            <div className="space-y-2">
              {preview.sample_items.map(item => (
                <div key={item.url} className="rounded-lg border border-border bg-bg-card px-3 py-2">
                  <p className="text-sm font-medium text-text line-clamp-2">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span>{extractDomain(item.url) ?? item.url}</span>
                    {item.published_at && (
                      <span>{new Date(item.published_at).toLocaleString()}</span>
                    )}
                  </div>
                  {item.excerpt && (
                    <p className="mt-2 text-xs text-muted line-clamp-3">{item.excerpt}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
