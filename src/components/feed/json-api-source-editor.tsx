import { useMemo, useState } from 'react'
import Editor from 'react-simple-code-editor'
import hljs from 'highlight.js/lib/core'
import javascriptLang from 'highlight.js/lib/languages/javascript'
import { Sparkles, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useI18n } from '../../lib/i18n'
import { extractDomain } from '../../lib/url'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

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
  generateError?: string | null
  generating?: boolean
  onGenerateWithAi?: () => void
  onLoadTemplate?: () => void
}

function renderCode(code: string): string {
  const source = code.trim() || JSON_API_TEMPLATE
  const html = hljs.highlight(source, { language: 'javascript' }).value
  return code.trim() ? html : `<span class="text-muted opacity-40">${html}</span>`
}

function buildAiPrompt(endpointUrl: string): string {
  const targetUrl = endpointUrl.trim() || 'https://example.com/api/stories'
  return `Write a JavaScript transform function for Oksskolten JSON API feeds.

Return only a JavaScript function expression. Do not wrap it in markdown.

Feed endpoint:
${targetUrl}

Required function signature:
({ response, endpointUrl, fetchedAt, helpers }) => ({ items: [...] })
or
({ response, endpointUrl, fetchedAt, helpers }) => [...]

The function should map the JSON response into feed items with this shape:
- url: string, required, final article URL, must be https
- title: string, required, article title
- published_at: string | null, optional ISO date/time
- excerpt: string | null, optional short preview text shown in the list
- content_text: string | null, optional plain text or markdown body
- content_html: string | null, optional HTML body if the API returns rich text
- og_image: string | null, optional preview image URL

Optional top-level return fields:
- title: feed display name
- icon_url: feed icon URL
- view_type: "article" or "social"

Rules:
- Preserve useful text fields from the API whenever possible
- Prefer content_text for plain text fields and content_html for HTML fields
- If the response is nested, first locate the array of stories/items/posts
- Use null for missing optional fields
- Keep the script defensive: return [] if the response is unusable
- Do not use fetch, imports, timers, or external libraries
- You may use helpers.cleanUrl and helpers.normalizeDate if useful

Produce only the function expression.`
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
  generateError,
  generating = false,
  onGenerateWithAi,
  onLoadTemplate,
}: JsonApiSourceEditorProps) {
  const { t } = useI18n()
  const [showAiPrompt, setShowAiPrompt] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const canPreview = endpointUrl.trim().length > 0 && transformScript.trim().length > 0 && !previewLoading
  const aiPrompt = useMemo(() => buildAiPrompt(endpointUrl), [endpointUrl])

  async function handleCopyAiPrompt() {
    try {
      await navigator.clipboard.writeText(aiPrompt)
      setCopiedPrompt(true)
      window.setTimeout(() => setCopiedPrompt(false), 1500)
    } catch {
      setCopiedPrompt(false)
    }
  }

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
          <div className="flex items-center gap-2">
            <label className="block text-xs font-medium text-muted" htmlFor="json-api-transform-script">
              {t('jsonApi.transformScript')}
            </label>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-text transition-colors"
                    aria-label={t('jsonApi.aiPromptTooltip')}
                    onClick={() => setShowAiPrompt(prev => !prev)}
                  >
                    <Info size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="hidden max-w-[18rem] md:block">
                  {t('jsonApi.aiPromptTooltip')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2">
            {onLoadTemplate && (
              <Button type="button" size="sm" variant="outline" onClick={onLoadTemplate}>
                {t('jsonApi.useTemplate')}
              </Button>
            )}
            {onGenerateWithAi && (
              <Button type="button" size="sm" variant="outline" onClick={onGenerateWithAi} disabled={generating || !endpointUrl.trim()}>
                <Sparkles size={14} />
                {generating ? t('jsonApi.generating') : t('jsonApi.generateWithAi')}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setShowAiPrompt(prev => !prev)}>
              <Sparkles size={14} />
              {t('jsonApi.aiPromptButton')}
            </Button>
          </div>
        </div>

        {showAiPrompt && (
          <div className="rounded-md border border-border bg-bg-subtle p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-text">{t('jsonApi.aiPromptTitle')}</p>
                <p className="text-xs text-muted">{t('jsonApi.aiPromptDesc')}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyAiPrompt()}>
                {copiedPrompt ? t('jsonApi.copied') : t('jsonApi.copyPrompt')}
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-bg-card px-3 py-3 text-xs text-text whitespace-pre-wrap break-words">{aiPrompt}</pre>
          </div>
        )}

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
          <p className="font-medium text-text">{t('jsonApi.contractTitle')}</p>
          <p><code>{t('jsonApi.contractInput')}</code></p>
          <p><code>{t('jsonApi.contractOutput')}</code></p>
        </div>

        <div className="rounded-md border border-border bg-bg-subtle px-3 py-3 text-xs text-muted space-y-3">
          <div>
            <p className="font-medium text-text">{t('jsonApi.fieldGuideTitle')}</p>
            <p className="mt-1">{t('jsonApi.fieldGuideDesc')}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="font-medium text-text"><code>url</code></p>
              <p>{t('jsonApi.field.url')}</p>
            </div>
            <div>
              <p className="font-medium text-text"><code>title</code></p>
              <p>{t('jsonApi.field.title')}</p>
            </div>
            <div>
              <p className="font-medium text-text"><code>published_at</code></p>
              <p>{t('jsonApi.field.publishedAt')}</p>
            </div>
            <div>
              <p className="font-medium text-text"><code>excerpt</code></p>
              <p>{t('jsonApi.field.excerpt')}</p>
            </div>
            <div>
              <p className="font-medium text-text"><code>content_text</code></p>
              <p>{t('jsonApi.field.contentText')}</p>
            </div>
            <div>
              <p className="font-medium text-text"><code>content_html</code></p>
              <p>{t('jsonApi.field.contentHtml')}</p>
            </div>
            <div>
              <p className="font-medium text-text"><code>og_image</code></p>
              <p>{t('jsonApi.field.ogImage')}</p>
            </div>
            <div>
              <p className="font-medium text-text"><code>title / icon_url / view_type</code></p>
              <p>{t('jsonApi.field.feedMeta')}</p>
            </div>
          </div>
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

      {generateError && <p className="text-xs text-error">{generateError}</p>}
      {previewError && <p className="text-xs text-error">{previewError}</p>}

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
