import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Check, X, Trash2 } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { IconButton } from '../ui/icon-button'
import { Input } from '../ui/input'
import { fetcher, apiPatch, apiPost } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'

interface ImageStorageData {
  'images.enabled': string | null
  mode: string
  url: string
  headersConfigured: boolean
  fieldName: string
  respPath: string
  healthcheckUrl: string
  'images.storage_path': string | null
  'images.max_size_mb': string | null
}

interface ImageStorageFeedUsage {
  feed_id: number
  feed_name: string
  count: number
  size_bytes: number
}

interface ImageStorageStats {
  total_count: number
  total_size_bytes: number
  orphan_count: number
  orphan_size_bytes: number
  orphan_files: string[]
  by_feed: ImageStorageFeedUsage[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// Note: This component intentionally does NOT use useSettings / Prefs.
// Other preferences (theme, dateMode, etc.) use localStorage as a fast cache
// with automatic debounce-save to DB. Image storage settings differ in that:
//   1. They contain sensitive values (auth headers) that must not be cached locally
//   2. They require explicit "Save" — partial/untested config should not auto-persist
//   3. They use a dedicated API endpoint with server-side validation and test support
// Instead, only non-sensitive fields are cached in localStorage for instant rendering,
// while the full state (including secrets) is always fetched from the API.

const CACHE_KEY = 'image-storage-cache'

interface CachedImageStorage {
  enabled: boolean
  storagePath: string
  maxSize: string
  mode: string
}

function readCache(): CachedImageStorage | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCache(values: CachedImageStorage) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(values)) } catch {}
}

export function ImageStorageSettings() {
  const { t } = useI18n()
  const { data, mutate } = useSWR<ImageStorageData>('/api/settings/image-storage', fetcher)
  const { data: statsData, mutate: mutateStats } = useSWR<ImageStorageStats>('/api/settings/image-storage/stats', fetcher)

  const cached = readCache()
  const [enabled, setEnabled] = useState(cached?.enabled ?? false)
  const [storagePath, setStoragePath] = useState(cached?.storagePath ?? '')
  const [maxSize, setMaxSize] = useState(cached?.maxSize ?? '10')
  const [mode, setMode] = useState<string | null>(cached?.mode ?? null)
  const [url, setUrl] = useState<string | null>(null)
  const [headers, setHeaders] = useState('')
  const [clearHeaders, setClearHeaders] = useState(false)
  const [editingHeaders, setEditingHeaders] = useState(false)
  const [fieldName, setFieldName] = useState<string | null>(null)
  const [respPath, setRespPath] = useState<string | null>(null)
  const [healthcheckUrl, setHealthcheckUrl] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [healthchecking, setHealthchecking] = useState(false)
  const [healthResult, setHealthResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [purging, setPurging] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<{ orphan_count: number; orphan_size_bytes: number; candidates?: string[] } | null>(null)

  useEffect(() => {
    if (data) {
      const e = data['images.enabled'] === '1' || data['images.enabled'] === 'true'
      const sp = data['images.storage_path'] || ''
      const ms = data['images.max_size_mb'] || '10'
      setEnabled(e)
      setStoragePath(sp)
      setMaxSize(ms)
      setMode(null)
      writeCache({ enabled: e, storagePath: sp, maxSize: ms, mode: data.mode })
    }
  }, [data])

  if (!data && !cached) return null

  const displayMode = mode ?? data?.mode ?? cached?.mode ?? 'local'
  const displayUrl = url ?? data?.url ?? ''
  const displayFieldName = fieldName ?? data?.fieldName ?? ''
  const displayRespPath = respPath ?? data?.respPath ?? ''
  const displayHealthcheckUrl = healthcheckUrl ?? data?.healthcheckUrl ?? ''
  const isRemote = displayMode === 'remote'

  const serverEnabled = data ? (data['images.enabled'] === '1' || data['images.enabled'] === 'true') : cached?.enabled ?? false
  const serverStoragePath = data?.['images.storage_path'] || ''
  const serverMaxSize = data?.['images.max_size_mb'] || '10'
  const isDirty =
    enabled !== serverEnabled ||
    storagePath !== serverStoragePath ||
    maxSize !== serverMaxSize ||
    mode !== null || url !== null || headers !== '' || clearHeaders || fieldName !== null || respPath !== null || healthcheckUrl !== null

  function showMessage(msg: string, type: 'error' | 'success') {
    if (type === 'error') {
      setError(msg)
      setSuccess(null)
    } else {
      setSuccess(msg)
      setError(null)
    }
    setTimeout(() => { setError(null); setSuccess(null) }, 3000)
  }

  async function handleScanOrphans() {
    setPurging(true)
    setError(null)
    try {
      const res = await apiPost('/api/settings/image-storage/purge-orphans', { dry_run: true }) as {
        orphan_count: number
        orphan_size_bytes: number
        candidates?: string[]
      }
      setDryRunResult(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setPurging(false)
    }
  }

  async function handlePurgeOrphans() {
    setPurging(true)
    setError(null)
    try {
      const res = await apiPost('/api/settings/image-storage/purge-orphans', { dry_run: false }) as {
        purged_count: number
        reclaimed_bytes: number
      }
      setDryRunResult(null)
      showMessage(`${res.purged_count} ${t('imageStorage.purgeSuccess')} (${formatBytes(res.reclaimed_bytes)})`, 'success')
      void mutateStats()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Purge failed')
    } finally {
      setPurging(false)
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, string> = {
        'images.enabled': enabled ? '1' : '',
        'images.storage_path': storagePath || '',
        'images.max_size_mb': maxSize || '',
      }
      if (mode !== null) body.mode = mode
      if (url !== null) body.url = url
      if (clearHeaders) body.headers = ''
      else if (headers) body.headers = headers
      if (fieldName !== null) body.fieldName = fieldName
      if (respPath !== null) body.respPath = respPath
      if (healthcheckUrl !== null) body.healthcheckUrl = healthcheckUrl
      await apiPatch('/api/settings/image-storage', body)
      writeCache({ enabled, storagePath, maxSize, mode: mode ?? data?.mode ?? 'local' })
      void mutate()
      setMode(null)
      setUrl(null)
      setHeaders('')
      setClearHeaders(false)
      setEditingHeaders(false)
      setFieldName(null)
      setRespPath(null)
      setHealthcheckUrl(null)
      showMessage(t('imageStorage.saved'), 'success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Save failed'
      showMessage(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await apiPost('/api/settings/image-storage/test')
      setTestResult({ ok: true, message: res.url })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Test failed'
      setTestResult({ ok: false, message })
    } finally {
      setTesting(false)
    }
  }

  async function handleHealthcheck() {
    if (healthchecking) return
    setHealthchecking(true)
    setHealthResult(null)
    try {
      await apiPost('/api/settings/image-storage/healthcheck')
      setHealthResult({ ok: true, message: t('imageStorage.healthcheckOk') })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Healthcheck failed'
      setHealthResult({ ok: false, message })
    } finally {
      setHealthchecking(false)
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('imageStorage.title')}</h2>
      <p className="text-xs text-muted mb-4">{t('imageStorage.desc')}</p>

      <div className="space-y-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text">{t('imageStorage.enabled')}</p>
            <p className="text-xs text-muted">{t('imageStorage.enabledDesc')}</p>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              enabled ? 'bg-accent' : 'bg-border'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

        {enabled && (
          <>
            {/* Mode selector */}
            <div>
              <label className="block text-sm font-medium text-text mb-2 select-none">{t('imageStorage.mode')}</label>
              <div className="flex gap-2">
                {(['local', 'remote'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 text-sm rounded-lg border select-none transition-colors ${
                      displayMode === m
                        ? 'border-accent text-accent font-medium'
                        : 'border-border text-muted hover:text-text'
                    }`}
                    style={displayMode === m ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' } : undefined}
                  >
                    {t(m === 'local' ? 'imageStorage.modeLocal' : 'imageStorage.modeRemote')}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-3 px-3 py-2 rounded-lg bg-hover">
                {t(displayMode === 'local' ? 'imageStorage.modeLocalDesc' : 'imageStorage.modeRemoteDesc')}
              </p>
            </div>

            {!isRemote && (
              <>
                {/* Storage path */}
                <div>
                  <label className="block text-xs text-muted mb-1 select-none">{t('imageStorage.storagePath')}</label>
                  <Input
                    type="text"
                    value={storagePath}
                    onChange={e => setStoragePath(e.target.value)}
                    placeholder="data/articles/images"
                  />
                </div>

                {/* Max size */}
                <div>
                  <label className="block text-xs text-muted mb-1 select-none">{t('imageStorage.maxSize')}</label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={maxSize}
                    onChange={e => setMaxSize(e.target.value)}
                    className="w-24"
                  />
                </div>
              </>
            )}

            {isRemote && (
              <>
                {/* Upload URL */}
                <div>
                  <label className="block text-xs text-muted mb-1 select-none">{t('imageStorage.url')}</label>
                  <Input
                    type="text"
                    value={displayUrl}
                    onChange={e => setUrl(e.target.value)}
                    placeholder={t('imageStorage.urlPlaceholder')}
                  />
                </div>

                {/* Headers */}
                <div>
                  <div className="flex items-center gap-2 text-xs text-muted mb-1 select-none">
                    <span>{t('imageStorage.headers')}</span>
                    {data?.headersConfigured && !clearHeaders && (
                      <>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
                          <Check size={10} />
                          {t('imageStorage.headersConfigured')}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconButton
                              size="xs"
                              onClick={() => { setClearHeaders(true); setHeaders(''); setEditingHeaders(true) }}
                              className="text-error hover:text-error hover:opacity-70"
                            >
                              <Trash2 size={11} />
                            </IconButton>
                          </TooltipTrigger>
                          <TooltipContent>{t('imageStorage.headersClear')}</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                  {data?.headersConfigured && !clearHeaders && !editingHeaders ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setEditingHeaders(true)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setEditingHeaders(true) }}
                      className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-muted cursor-pointer hover:border-accent/50 transition-colors select-none"
                    >
                      ••••••••
                    </div>
                  ) : (
                    <textarea
                      value={headers}
                      onChange={e => { setHeaders(e.target.value); setClearHeaders(false) }}
                      placeholder={t('imageStorage.headersPlaceholder')}
                      rows={2}
                      className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text placeholder:text-muted/50 outline-none focus:border-accent font-mono resize-none"
                    />
                  )}
                </div>

                {/* Field name */}
                <div>
                  <label className="block text-xs text-muted mb-1 select-none">{t('imageStorage.fieldName')}</label>
                  <Input
                    type="text"
                    value={displayFieldName}
                    onChange={e => setFieldName(e.target.value)}
                    placeholder={t('imageStorage.fieldNamePlaceholder')}
                  />
                </div>

                {/* Response path */}
                <div>
                  <label className="block text-xs text-muted mb-1 select-none">{t('imageStorage.respPath')}</label>
                  <Input
                    type="text"
                    value={displayRespPath}
                    onChange={e => setRespPath(e.target.value)}
                    placeholder={t('imageStorage.respPathPlaceholder')}
                    className="font-mono"
                  />
                </div>

                {/* Healthcheck URL */}
                <div>
                  <label className="block text-xs text-muted mb-1 select-none">{t('imageStorage.healthcheckUrl')}</label>
                  <Input
                    type="text"
                    value={displayHealthcheckUrl}
                    onChange={e => setHealthcheckUrl(e.target.value)}
                    placeholder={t('imageStorage.healthcheckUrlPlaceholder')}
                  />
                  <p className="text-[11px] text-muted mt-1">{t('imageStorage.healthcheckUrlDesc')}</p>
                </div>
              </>
            )}
          </>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
            >
              {saving ? '...' : t('settings.save')}
            </button>
          )}

          {enabled && isRemote && !isDirty && data?.mode === 'remote' && (
            <>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
              >
                {testing ? t('imageStorage.testing') : t('imageStorage.test')}
              </button>
              {data?.healthcheckUrl && (
                <button
                  type="button"
                  onClick={handleHealthcheck}
                  disabled={healthchecking}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
                >
                  {healthchecking ? t('imageStorage.healthchecking') : t('imageStorage.healthcheck')}
                </button>
              )}
            </>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`text-sm ${testResult.ok ? 'text-accent' : 'text-error'}`}>
            <div className="flex items-center gap-1.5">
              {testResult.ok ? <Check size={14} /> : <X size={14} />}
              <span>{testResult.ok ? t('imageStorage.testSuccess') : t('imageStorage.testFailed')}</span>
            </div>
            {testResult.message && (
              <a
                href={testResult.message}
                target="_blank"
                rel="noopener noreferrer"
                className={`block text-xs mt-1 break-all ${testResult.ok ? 'text-muted hover:text-text' : 'text-error'} transition-colors`}
              >
                {testResult.message}
              </a>
            )}
          </div>
        )}

        {/* Healthcheck result */}
        {healthResult && (
          <div className={`text-sm ${healthResult.ok ? 'text-accent' : 'text-error'}`}>
            <div className="flex items-center gap-1.5">
              {healthResult.ok ? <Check size={14} /> : <X size={14} />}
              <span>{healthResult.message}</span>
            </div>
          </div>
        )}

        {/* Messages */}
        {error && <p className="text-sm text-error">{error}</p>}
        {success && <p className="text-sm text-accent">{success}</p>}

        {/* Storage usage dashboard & orphan cleanup (issue #14) */}
        <div className="mt-6 pt-6 border-t border-border space-y-4">
          <label className="block text-sm font-medium text-text select-none">
            {t('imageStorage.dashboard')}
          </label>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border border-border bg-bg-subtle">
              <div className="text-xs text-muted">{t('imageStorage.totalImages')}</div>
              <div className="text-lg font-semibold text-text mt-1">{statsData?.total_count ?? 0}</div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-bg-subtle">
              <div className="text-xs text-muted">{t('imageStorage.totalSize')}</div>
              <div className="text-lg font-semibold text-text mt-1">{formatBytes(statsData?.total_size_bytes ?? 0)}</div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-bg-subtle col-span-2 md:col-span-1">
              <div className="text-xs text-muted">{t('imageStorage.orphanCount')}</div>
              <div className="text-lg font-semibold text-text mt-1">
                {statsData?.orphan_count ?? 0} ({formatBytes(statsData?.orphan_size_bytes ?? 0)})
              </div>
            </div>
          </div>

          {statsData?.by_feed && statsData.by_feed.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted">{t('imageStorage.byFeed')}</span>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {statsData.by_feed.map(f => (
                  <div key={f.feed_id} className="flex justify-between items-center text-xs py-1 px-2.5 rounded bg-bg-subtle border border-border/50">
                    <span className="truncate max-w-[60%] text-text">{f.feed_name}</span>
                    <span className="text-muted">{f.count} images · {formatBytes(f.size_bytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={handleScanOrphans}
              disabled={purging}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
            >
              {purging ? t('imageStorage.testing') : t('imageStorage.scanOrphans')}
            </button>
            <button
              type="button"
              onClick={handlePurgeOrphans}
              disabled={purging}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-error/50 text-error hover:bg-error/10 transition-colors disabled:opacity-50 select-none"
            >
              {purging ? t('imageStorage.testing') : t('imageStorage.purgeOrphans')}
            </button>
          </div>

          {dryRunResult && (
            <div className="p-3 rounded-lg border border-border bg-bg-subtle text-xs space-y-1">
              <div className="font-medium text-text">
                Scan result: {dryRunResult.orphan_count} orphan candidate(s) ({formatBytes(dryRunResult.orphan_size_bytes)})
              </div>
              {dryRunResult.candidates && dryRunResult.candidates.length > 0 && (
                <div className="text-muted max-h-24 overflow-y-auto text-[11px] font-mono mt-1">
                  {dryRunResult.candidates.map(file => (
                    <div key={file}>{file}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
