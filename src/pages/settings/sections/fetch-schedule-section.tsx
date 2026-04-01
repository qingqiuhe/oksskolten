import { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
import { useI18n } from '../../../lib/i18n'
import { apiPatch, fetcher } from '../../../lib/fetcher'

interface FetchScheduleSettings {
  min_interval_minutes: number
}

const DEFAULT_MIN_INTERVAL_MINUTES = 15

export function FetchScheduleSection() {
  const { t } = useI18n()
  const { data, mutate } = useSWR<FetchScheduleSettings>('/api/settings/fetch-schedule', fetcher)
  const serverValue = data?.min_interval_minutes ?? DEFAULT_MIN_INTERVAL_MINUTES

  const [localValue, setLocalValue] = useState(String(serverValue))
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLocalValue(String(serverValue))
  }, [serverValue])

  const commitValue = useCallback(async () => {
    const nextValue = Number(localValue)
    if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 240) {
      setLocalValue(String(serverValue))
      setMessage(t('settings.fetchScheduleInvalid'))
      return
    }

    if (nextValue === serverValue) {
      setMessage(null)
      return
    }

    const optimistic = { min_interval_minutes: nextValue }
    setSaving(true)
    setMessage(null)
    await mutate(optimistic, false)

    try {
      const saved = await apiPatch('/api/settings/fetch-schedule', optimistic) as FetchScheduleSettings
      await mutate(saved, false)
      setLocalValue(String(saved.min_interval_minutes))
      setMessage(t('settings.saved'))
    } catch (err) {
      await mutate()
      setLocalValue(String(serverValue))
      setMessage(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setSaving(false)
    }
  }, [localValue, mutate, serverValue, t])

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-1">{t('settings.fetchSchedule')}</h2>
      <p className="text-xs text-muted mb-4">{t('settings.fetchScheduleDesc')}</p>

      <div>
        <p className="text-sm text-text mb-1">{t('settings.fetchScheduleMinInterval')}</p>
        <p className="text-xs text-muted mb-2">{t('settings.fetchScheduleHint')}</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={240}
            value={localValue}
            disabled={saving}
            onChange={(e) => {
              setLocalValue(e.target.value)
              if (message) setMessage(null)
            }}
            onBlur={() => { void commitValue() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitValue()
            }}
            className="w-20 px-2 py-1 text-sm rounded-lg border border-border bg-bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
          <span className="text-sm text-muted">{t('settings.fetchScheduleMinutes')}</span>
        </div>
        {message && (
          <p className={`text-xs mt-2 ${message === t('settings.saved') ? 'text-accent' : 'text-error'}`}>
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
