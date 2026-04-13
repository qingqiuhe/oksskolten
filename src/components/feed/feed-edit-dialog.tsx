import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import type { FeedPriorityLevel, FeedWithCounts } from '../../../shared/types'
import { useI18n } from '../../lib/i18n'
import { fetcher, apiPost } from '../../lib/fetcher'
import { normalizeFeedIconUrl, isValidFeedIconUrl } from '../../lib/feed-icon-url'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { FeedIconPreview } from './feed-icon-preview'
import { FeedPriorityPicker } from './feed-priority-picker'
import { JsonApiSourceEditor, type JsonApiPreviewResponse } from './json-api-source-editor'

interface FeedEditDialogProps {
  feed: FeedWithCounts
  name: string
  iconUrl: string
  priorityLevel: FeedPriorityLevel
  onNameChange: (value: string) => void
  onIconUrlChange: (value: string) => void
  onPriorityLevelChange: (value: FeedPriorityLevel) => void
  onSubmit: () => void | Promise<void>
  onUpdateJsonApiConfig?: (transformScript: string) => void | Promise<void>
  onFetchUpdatedJsonApiFeed?: () => void
  onClose: () => void
}

function getPreviewKey(url: string, script: string): string {
  return JSON.stringify([url, script])
}

export function FeedEditDialog({
  feed,
  name,
  iconUrl,
  priorityLevel,
  onNameChange,
  onIconUrlChange,
  onPriorityLevelChange,
  onSubmit,
  onUpdateJsonApiConfig,
  onFetchUpdatedJsonApiFeed,
  onClose,
}: FeedEditDialogProps) {
  const { t } = useI18n()
  const isJsonApiFeed = feed.ingest_kind === 'json_api'
  const [error, setError] = useState('')
  const [jsonApiError, setJsonApiError] = useState('')
  const [preview, setPreview] = useState<JsonApiPreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { data: jsonApiConfig, error: jsonApiConfigError } = useSWR<{ transform_script: string }>(
    isJsonApiFeed ? `/api/feeds/${feed.id}/json-api-config` : null,
    fetcher,
  )
  const [transformScript, setTransformScript] = useState('')

  useEffect(() => {
    if (jsonApiConfig?.transform_script != null) {
      setTransformScript(jsonApiConfig.transform_script)
      setPreview(null)
      setPreviewKey(null)
      setJsonApiError('')
    }
  }, [jsonApiConfig?.transform_script, feed.id])

  const currentPreviewKey = useMemo(
    () => getPreviewKey(feed.url, transformScript),
    [feed.url, transformScript],
  )
  const initialScript = jsonApiConfig?.transform_script ?? ''
  const scriptDirty = isJsonApiFeed && transformScript !== initialScript
  const previewDirty = preview != null && previewKey !== currentPreviewKey
  const requiresFreshPreview = scriptDirty && previewKey !== currentPreviewKey
  const loadingJsonApiConfig = isJsonApiFeed && !jsonApiConfig && !jsonApiConfigError

  async function handlePreview() {
    setPreviewLoading(true)
    setJsonApiError('')
    try {
      const result = await apiPost('/api/feeds/json-api/preview', {
        url: feed.url,
        name: name.trim() || undefined,
        icon_url: normalizeFeedIconUrl(iconUrl) ?? undefined,
        view_type: feed.view_type,
        transform_script: transformScript,
      }) as JsonApiPreviewResponse
      setPreview(result)
      setPreviewKey(currentPreviewKey)
    } catch (err) {
      setJsonApiError(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleSubmit() {
    const normalizedIconUrl = normalizeFeedIconUrl(iconUrl)
    if (normalizedIconUrl && !isValidFeedIconUrl(normalizedIconUrl)) {
      setError(t('feeds.avatarUrlInvalid'))
      return
    }
    if (requiresFreshPreview) {
      setJsonApiError(t('jsonApi.previewRequired'))
      return
    }

    setError('')
    setSaving(true)
    try {
      await onSubmit()
      if (scriptDirty) {
        await onUpdateJsonApiConfig?.(transformScript)
      }
      onClose()
      if (isJsonApiFeed) {
        void onFetchUpdatedJsonApiFeed?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={isJsonApiFeed ? 'max-w-3xl' : 'max-w-sm'} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">{t('feeds.editFeed')}</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
        >
          <div className={isJsonApiFeed ? 'grid gap-4 md:grid-cols-2' : 'space-y-4'}>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted" htmlFor="feed-edit-name">
                {t('feeds.rename')}
              </label>
              <Input
                id="feed-edit-name"
                autoFocus
                value={name}
                onChange={e => onNameChange(e.target.value)}
                placeholder={t('modal.namePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted" htmlFor="feed-edit-icon-url">
                {t('feeds.avatarUrl')}
              </label>
              <Input
                id="feed-edit-icon-url"
                type="url"
                value={iconUrl}
                onChange={e => {
                  setError('')
                  onIconUrlChange(e.target.value)
                }}
                placeholder={t('feeds.avatarUrlPlaceholder')}
              />
              <FeedIconPreview iconUrl={normalizeFeedIconUrl(iconUrl)} feedUrl={feed.url} name={name} />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!iconUrl.trim()}
                  onClick={() => {
                    setError('')
                    onIconUrlChange('')
                  }}
                >
                  {t('feeds.clearAvatar')}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted" htmlFor="feed-edit-priority">
              {t('feeds.priority.label')}
            </label>
            <div id="feed-edit-priority">
              <FeedPriorityPicker value={priorityLevel} onChange={onPriorityLevelChange} />
            </div>
          </div>

          {isJsonApiFeed && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div>
                <h3 className="text-sm font-medium text-text">{t('jsonApi.sourceSection')}</h3>
                <p className="text-xs text-muted mt-1">{t('jsonApi.sourceSectionDesc')}</p>
              </div>

              {loadingJsonApiConfig && (
                <p className="text-xs text-muted">{t('jsonApi.loadingConfig')}</p>
              )}

              {jsonApiConfigError && (
                <p className="text-xs text-error">{t('jsonApi.loadingConfigFailed')}</p>
              )}

              {!loadingJsonApiConfig && !jsonApiConfigError && (
                <JsonApiSourceEditor
                  endpointUrl={feed.url}
                  endpointReadOnly
                  transformScript={transformScript}
                  onTransformScriptChange={(value) => {
                    setTransformScript(value)
                    setJsonApiError('')
                  }}
                  viewType={feed.view_type ?? 'auto'}
                  preview={preview}
                  previewError={jsonApiError}
                  previewLoading={previewLoading}
                  previewDirty={previewDirty}
                  onPreview={() => { void handlePreview() }}
                />
              )}
            </div>
          )}

          {error && <p className="text-xs text-error">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('settings.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || saving || loadingJsonApiConfig || !!jsonApiConfigError || requiresFreshPreview}>
              {saving ? t('jsonApi.saving') : t('settings.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
