import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useI18n } from '../../../lib/i18n'
import { apiPatch, fetcher } from '../../../lib/fetcher'
import { Input } from '../../../components/ui/input'
import { Button } from '../../../components/ui/button'

interface SocialSourcesSettings {
  rsshub_base_url: string
}

export function SocialSourcesSection() {
  const { t } = useI18n()
  const { data, mutate } = useSWR<SocialSourcesSettings>('/api/settings/social-sources', fetcher)
  const [rsshubBaseUrl, setRsshubBaseUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRsshubBaseUrl(data?.rsshub_base_url ?? '')
  }, [data?.rsshub_base_url])

  const isDirty = rsshubBaseUrl !== (data?.rsshub_base_url ?? '')

  async function handleSave() {
    if (saving || !isDirty) return
    setSaving(true)
    setMessage(null)
    try {
      const saved = await apiPatch('/api/settings/social-sources', {
        rsshub_base_url: rsshubBaseUrl,
      }) as SocialSourcesSettings
      await mutate(saved, false)
      setRsshubBaseUrl(saved.rsshub_base_url)
      setMessage(t('settings.saved'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('settings.socialSources')}</h2>
      <p className="text-xs text-muted mb-4">{t('settings.socialSourcesDesc')}</p>

      <div className="space-y-2">
        <label className="block text-sm text-text" htmlFor="social-rsshub-base-url">
          {t('settings.socialRsshubBaseUrl')}
        </label>
        <Input
          id="social-rsshub-base-url"
          type="url"
          placeholder="https://rsshub-gamma-ebon.vercel.app"
          value={rsshubBaseUrl}
          onChange={(e) => {
            setRsshubBaseUrl(e.target.value)
            if (message) setMessage(null)
          }}
        />
        <p className="text-xs text-muted">{t('settings.socialRsshubBaseUrlHint')}</p>
        {message && (
          <p className={`text-xs ${message === t('settings.saved') ? 'text-accent' : 'text-error'}`}>
            {message}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" onClick={() => { void handleSave() }} disabled={!isDirty || saving}>
            {saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </div>
      </div>
    </section>
  )
}
