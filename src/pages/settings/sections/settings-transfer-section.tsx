import { useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { Download, Upload } from 'lucide-react'
import { useI18n } from '../../../lib/i18n'
import {
  fetchSettingsExportBlob,
  importSettingsBundle,
  previewSettingsImport,
  type SettingsTransferResult,
} from '../../../lib/fetcher'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'

const SUMMARY_KEYS = ['instanceSettings', 'userSettings', 'customLlmProviders', 'notificationChannels'] as const

export function SettingsTransferSection() {
  const { t } = useI18n()
  const { mutate: globalMutate } = useSWRConfig()
  const fileRef = useRef<HTMLInputElement>(null)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [bundle, setBundle] = useState<unknown>(null)
  const [preview, setPreview] = useState<SettingsTransferResult | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setBusy(true)
    setError(null)
    try {
      const blob = await fetchSettingsExportBlob(includeSecrets)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `oksskolten-settings-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.settingsExportFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const result = await previewSettingsImport(parsed)
      setBundle(parsed)
      setPreview(result)
      setIsPreviewOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.settingsImportFailed'))
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  async function handleImport() {
    if (!bundle) return
    setBusy(true)
    setError(null)
    try {
      await importSettingsBundle(bundle)
      setMessage(t('settings.settingsImportSuccess'))
      setIsPreviewOpen(false)
      void globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/settings'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.settingsImportFailed'))
    } finally {
      setBusy(false)
    }
  }

  function formatSummary(result: SettingsTransferResult, key: typeof SUMMARY_KEYS[number]) {
    const item = result.summary[key]
    return t('settings.settingsImportSummary')
      .replace('{created}', String(item.created))
      .replace('{updated}', String(item.updated))
      .replace('{skipped}', String(item.skipped))
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-4">{t('settings.settingsTransfer')}</h2>
      <p className="text-xs text-muted mb-3">{t('settings.settingsTransferDesc')}</p>

      <label className="inline-flex items-center gap-2 text-sm text-text mb-3">
        <input
          type="checkbox"
          checked={includeSecrets}
          onChange={(event) => setIncludeSecrets(event.target.checked)}
          className="accent-accent"
        />
        {t('settings.includeSensitiveSettings')}
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
        >
          <Download size={14} />
          {t('settings.exportSettings')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
        >
          <Upload size={14} />
          {t('settings.importSettings')}
        </button>
      </div>

      {message && <p className="text-xs text-accent mt-2">{message}</p>}
      {error && <p className="text-xs text-error mt-2">{error}</p>}

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('settings.settingsImportPreview')}</DialogTitle>
            {preview && (
              <div className="text-sm text-muted space-y-1 mt-2">
                {SUMMARY_KEYS.map(key => (
                  <span key={key} className="block">
                    {key}: {formatSummary(preview, key)}
                  </span>
                ))}
              </div>
            )}
          </DialogHeader>

          {preview && preview.warnings.length > 0 && (
            <div className="max-h-32 overflow-y-auto text-xs text-muted space-y-1 my-2 border border-border p-2 rounded">
              {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors"
            >
              {t('header.back')}
            </button>
            <button
              data-testid="confirm-import-btn"
              type="button"
              onClick={handleImport}
              disabled={busy || !preview?.ok}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {t('settings.settingsImportConfirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
