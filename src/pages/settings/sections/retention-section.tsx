import { useState, useCallback, useEffect } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useI18n } from '../../../lib/i18n'
import { fetcher, apiPatch, apiPost } from '../../../lib/fetcher'
import { RadioGroup } from '@/components/ui/radio-group'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Info, Trash2 } from 'lucide-react'

interface RetentionStats {
  readDays: number
  unreadDays: number
  readEligible: number
  unreadEligible: number
  databaseBytes: number
}

interface Preferences {
  'retention.enabled': string | null
  'retention.read_days': string | null
  'retention.unread_days': string | null
}

const DEFAULT_READ_DAYS = 90
const DEFAULT_UNREAD_DAYS = 180

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const rounded = value >= 10 || unitIndex === 0
    ? Math.round(value)
    : Math.round(value * 10) / 10

  return `${rounded} ${units[unitIndex]}`
}

export function RetentionSection() {
  const { t } = useI18n()
  const { mutate: globalMutate } = useSWRConfig()
  const { data: prefs, mutate: mutatePrefs } = useSWR<Preferences>('/api/settings/preferences', fetcher)
  const enabled = prefs?.['retention.enabled'] === 'on'
  const serverReadDays = Number(prefs?.['retention.read_days']) || DEFAULT_READ_DAYS
  const serverUnreadDays = Number(prefs?.['retention.unread_days']) || DEFAULT_UNREAD_DAYS

  // Local state for number inputs — synced from server, saved on blur
  const [localReadDays, setLocalReadDays] = useState(String(serverReadDays))
  const [localUnreadDays, setLocalUnreadDays] = useState(String(serverUnreadDays))

  useEffect(() => { setLocalReadDays(String(serverReadDays)) }, [serverReadDays])
  useEffect(() => { setLocalUnreadDays(String(serverUnreadDays)) }, [serverUnreadDays])

  const { data: stats, mutate: mutateStats } = useSWR<RetentionStats>(
    '/api/settings/retention/stats',
    fetcher,
    { refreshInterval: 0 },
  )

  const [purging, setPurging] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const savePref = useCallback(async (patch: Partial<Record<string, string>>) => {
    await apiPatch('/api/settings/preferences', patch)
    void mutatePrefs()
    void mutateStats()
  }, [mutatePrefs, mutateStats])

  const handleToggle = useCallback((value: 'on' | 'off') => {
    if (value === 'on') {
      // Save default day values together so the server never sees enabled=on without days configured
      void savePref({
        'retention.enabled': value,
        ...(!prefs?.['retention.read_days'] ? { 'retention.read_days': String(DEFAULT_READ_DAYS) } : {}),
        ...(!prefs?.['retention.unread_days'] ? { 'retention.unread_days': String(DEFAULT_UNREAD_DAYS) } : {}),
      })
    } else {
      void savePref({ 'retention.enabled': value })
    }
  }, [savePref, prefs])

  const commitReadDays = useCallback(() => {
    const num = Number(localReadDays)
    if (!Number.isInteger(num) || num < 1 || num > 9999) {
      setLocalReadDays(String(serverReadDays))
      return
    }
    if (num !== serverReadDays) {
      void savePref({ 'retention.read_days': String(num) })
    }
  }, [localReadDays, serverReadDays, savePref])

  const commitUnreadDays = useCallback(() => {
    const num = Number(localUnreadDays)
    if (!Number.isInteger(num) || num < 1 || num > 9999) {
      setLocalUnreadDays(String(serverUnreadDays))
      return
    }
    if (num !== serverUnreadDays) {
      void savePref({ 'retention.unread_days': String(num) })
    }
  }, [localUnreadDays, serverUnreadDays, savePref])

  const handlePurge = useCallback(async () => {
    setConfirmOpen(false)
    setPurging(true)
    setResult(null)
    try {
      const res = await apiPost('/api/settings/retention/purge') as { purged: number }
      setResult(t('settings.retentionPurgeResult').replace('{count}', String(res.purged)))
      void mutateStats()
      // Revalidate sidebar feeds and article lists
      void globalMutate((key: unknown) =>
        typeof key === 'string' && (key.includes('/api/feeds') || key.includes('/api/articles')),
      )
    } catch {
      setResult('Error')
    } finally {
      setPurging(false)
    }
  }, [t, mutateStats, globalMutate])

  const totalEligible = (stats?.readEligible ?? 0) + (stats?.unreadEligible ?? 0)

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('settings.articlePurge')}</h2>
      <p className="text-xs text-muted mb-4">{t('settings.articlePurgeDesc')}</p>
      {stats && (
        <div className="mb-4 text-xs text-muted">
          {t('settings.retentionDatabaseSize').replace('{size}', formatBytes(stats.databaseBytes))}
        </div>
      )}

      <div>
        <p className="text-sm text-text mb-1">{t('settings.retentionEnabled')}</p>
        <RadioGroup
          name="retentionEnabled"
          options={[
            { value: 'on' as const, label: 'ON' },
            { value: 'off' as const, label: 'OFF' },
          ]}
          value={enabled ? 'on' : 'off'}
          onChange={handleToggle}
        />
      </div>

      {enabled && (
        <>
          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('settings.retentionReadDays')}</p>
            <p className="text-xs text-muted mb-2">{t('settings.retentionReadDaysDesc')}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={9999}
                value={localReadDays}
                onChange={(e) => setLocalReadDays(e.target.value)}
                onBlur={commitReadDays}
                onKeyDown={(e) => { if (e.key === 'Enter') commitReadDays() }}
                className="w-20 px-2 py-1 text-sm rounded-lg border border-border bg-bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-sm text-muted">{t('settings.retentionDays')}</span>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm text-text mb-1">{t('settings.retentionUnreadDays')}</p>
            <p className="text-xs text-muted mb-2">{t('settings.retentionUnreadDaysDesc')}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={9999}
                value={localUnreadDays}
                onChange={(e) => setLocalUnreadDays(e.target.value)}
                onBlur={commitUnreadDays}
                onKeyDown={(e) => { if (e.key === 'Enter') commitUnreadDays() }}
                className="w-20 px-2 py-1 text-sm rounded-lg border border-border bg-bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-sm text-muted">{t('settings.retentionDays')}</span>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 text-xs text-muted">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>{t('settings.retentionProtectedNote')}</span>
          </div>

          {stats && (
            <div className="mt-4 text-xs text-muted">
              {t('settings.retentionEligible')
                .replace('{read}', String(stats.readEligible))
                .replace('{unread}', String(stats.unreadEligible))}
            </div>
          )}

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={purging || totalEligible === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50"
            >
              <Trash2 size={14} />
              {purging ? t('settings.retentionPurging') : t('settings.retentionPurgeNow')}
            </button>
            {result && (
              <p className="text-xs text-accent mt-2">{result}</p>
            )}
          </div>
        </>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title={t('settings.retentionPurgeNow')}
          message={t('settings.retentionPurgeConfirm').replace('{count}', String(totalEligible))}
          danger
          onConfirm={handlePurge}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </section>
  )
}
