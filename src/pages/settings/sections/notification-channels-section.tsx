import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { BellRing, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { fetcher, apiPost, apiPatch, apiDelete } from '../../../lib/fetcher'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import type { NotificationChannel } from '../../../../shared/types'

type TFunc = (key: any, params?: Record<string, string>) => string

interface ChannelFormState {
  id: number | null
  name: string
  webhook_url: string
  secret: string
  enabled: boolean
}

const EMPTY_FORM: ChannelFormState = {
  id: null,
  name: '',
  webhook_url: '',
  secret: '',
  enabled: true,
}

export function NotificationChannelsSection({ t }: { t: TFunc }) {
  const { data, mutate } = useSWR<{ channels: NotificationChannel[] }>(
    '/api/settings/notification-channels',
    fetcher,
    { revalidateOnFocus: false },
  )
  const channels = data?.channels ?? []
  const [form, setForm] = useState<ChannelFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 3000)
    return () => clearTimeout(timer)
  }, [message])

  const sortedChannels = useMemo(() => [...channels].sort((a, b) => b.id - a.id), [channels])
  const editing = form?.id != null

  async function handleSubmit() {
    if (!form || saving) return
    setSaving(true)
    try {
      const payload = {
        type: 'feishu_webhook' as const,
        name: form.name.trim(),
        webhook_url: form.webhook_url.trim(),
        secret: form.secret.trim() || null,
        enabled: form.enabled,
      }
      if (editing) {
        await apiPatch(`/api/settings/notification-channels/${form.id}`, payload)
      } else {
        await apiPost('/api/settings/notification-channels', payload)
      }
      await mutate()
      setForm(null)
      setMessage({ type: 'success', text: t('notifications.channelSaved') })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('modal.genericError') })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(channelId: number) {
    try {
      await apiDelete(`/api/settings/notification-channels/${channelId}`)
      await mutate()
      if (form?.id === channelId) setForm(null)
      setMessage({ type: 'success', text: t('notifications.channelDeleted') })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('modal.genericError') })
    }
  }

  async function handleTest(channelId: number) {
    setTestingId(channelId)
    try {
      await apiPost(`/api/settings/notification-channels/${channelId}/test`)
      setMessage({ type: 'success', text: t('notifications.channelTestSuccess') })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('modal.genericError') })
    } finally {
      setTestingId(null)
    }
  }

  async function handleToggle(channel: NotificationChannel) {
    try {
      await apiPatch(`/api/settings/notification-channels/${channel.id}`, { enabled: channel.enabled !== 1 })
      await mutate()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('modal.genericError') })
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text mb-1">{t('notifications.channelsTitle')}</h2>
          <p className="text-xs text-muted">{t('notifications.channelsDesc')}</p>
        </div>
        <button
          type="button"
          onClick={() => setForm(EMPTY_FORM)}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity"
        >
          <Plus size={13} />
          {t('notifications.channelCreate')}
        </button>
      </div>

      {channels.length > 0 && (
        <div className="space-y-3">
          {sortedChannels.map(channel => (
            <div key={channel.id} className="rounded-lg border border-border bg-bg-card p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${channel.enabled === 1 ? 'bg-success' : 'bg-muted'}`} />
                    <span className="text-sm font-medium text-text truncate">{channel.name}</span>
                    <span className="text-[11px] text-muted">{t('notifications.channelTypeFeishu')}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted truncate">{channel.webhook_url}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleTest(channel.id)}
                    className="px-2 py-1 text-xs rounded-md border border-border text-muted hover:text-text hover:bg-hover transition-colors"
                  >
                    {testingId === channel.id ? '...' : <Play size={13} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({
                      id: channel.id,
                      name: channel.name,
                      webhook_url: channel.webhook_url,
                      secret: channel.secret ?? '',
                      enabled: channel.enabled === 1,
                    })}
                    className="px-2 py-1 text-xs rounded-md border border-border text-muted hover:text-text hover:bg-hover transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggle(channel)}
                    className="px-2 py-1 text-xs rounded-md border border-border text-muted hover:text-text hover:bg-hover transition-colors"
                  >
                    {channel.enabled === 1 ? t('notifications.disable') : t('notifications.enable')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(channel.id)}
                    className="px-2 py-1 text-xs rounded-md border border-border text-error hover:bg-hover transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {channels.length === 0 && !form && (
        <div className="rounded-lg border border-dashed border-border bg-bg-card px-4 py-6 text-sm text-muted flex items-center gap-3">
          <BellRing size={18} className="shrink-0" />
          {t('notifications.channelsEmpty')}
        </div>
      )}

      {form && (
        <div className="rounded-lg border border-border bg-bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-text">
              {editing ? t('notifications.channelEdit') : t('notifications.channelAdd')}
            </h3>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="text-xs text-muted hover:text-text transition-colors"
            >
              {t('settings.cancel')}
            </button>
          </div>

          <FormField label={t('notifications.channelName')} compact>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </FormField>

          <FormField label={t('notifications.webhookUrl')} compact hint={t('notifications.webhookUrlHint')}>
            <Input
              type="url"
              value={form.webhook_url}
              onChange={e => setForm({ ...form, webhook_url: e.target.value })}
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
            />
          </FormField>

          <FormField label={t('notifications.secret')} compact hint={t('notifications.secretHint')}>
            <Input
              value={form.secret}
              onChange={e => setForm({ ...form, secret: e.target.value })}
              placeholder={t('notifications.secretPlaceholder')}
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={e => setForm({ ...form, enabled: e.target.checked })}
              className="accent-accent"
            />
            {t('notifications.channelEnabled')}
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? '...' : t('settings.save')}
            </button>
            {editing && form.id != null && (
              <button
                type="button"
                onClick={() => void handleTest(form.id!)}
                disabled={testingId === form.id}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors disabled:opacity-50"
              >
                {testingId === form.id ? '...' : t('notifications.testSend')}
              </button>
            )}
          </div>
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.type === 'error' ? 'text-error' : 'text-accent'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
