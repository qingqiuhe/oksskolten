import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { BellRing, Pencil, Trash2 } from 'lucide-react'
import { apiDelete, apiPatch, fetcher } from '../../../lib/fetcher'
import { useI18n } from '../../../lib/i18n'
import type { NotificationChannel, NotificationTaskRecord } from '../../../../shared/types'
import { formatLocalDateTime } from '../../../lib/dateTime'
import {
  NotificationRuleEditor,
  type NotificationRuleFormState,
  validateNotificationRuleForm,
} from '../../../components/notifications/notification-rule-editor'

type NotificationTaskScope = 'self' | 'all'

export function NotificationTasksSection() {
  const { t } = useI18n()
  const { data: me } = useSWR<{ id: number; role?: 'owner' | 'admin' | 'member' }>('/api/me', fetcher, { revalidateOnFocus: false })
  const isAdminLike = me?.role === 'owner' || me?.role === 'admin'
  const [scope, setScope] = useState<NotificationTaskScope>('self')
  const [form, setForm] = useState<(NotificationRuleFormState & { id: number }) | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (isAdminLike) {
      setScope(current => current === 'self' ? 'all' : current)
    }
  }, [isAdminLike])

  const { data, mutate } = useSWR<{ tasks: NotificationTaskRecord[]; scope: NotificationTaskScope }>(
    `/api/settings/notification-tasks?scope=${scope}`,
    fetcher,
    { revalidateOnFocus: false },
  )
  const { data: channelData } = useSWR<{ channels: NotificationChannel[] }>(
    '/api/settings/notification-channels',
    fetcher,
    { revalidateOnFocus: false },
  )

  const tasks = data?.tasks ?? []
  const availableChannels = useMemo(
    () => (channelData?.channels ?? []).filter(channel => channel.enabled === 1),
    [channelData],
  )
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => {
      const ownerA = a.owner.email ?? ''
      const ownerB = b.owner.email ?? ''
      if (ownerA !== ownerB) return ownerA.localeCompare(ownerB)
      return a.feed.name.localeCompare(b.feed.name)
    }),
    [tasks],
  )

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 3000)
    return () => window.clearTimeout(timer)
  }, [message])

  function openEdit(task: NotificationTaskRecord) {
    setForm({
      id: task.id,
      enabled: task.enabled === 1,
      delivery_mode: task.delivery_mode,
      content_mode: task.content_mode,
      translate_enabled: task.translate_enabled === 1,
      check_interval_minutes: String(task.check_interval_minutes),
      max_articles_per_message: String(task.max_articles_per_message),
      max_title_chars: String(task.max_title_chars),
      max_body_chars: String(task.max_body_chars),
      channel_ids: task.channels.map(channel => channel.id),
    })
    setMessage(null)
  }

  function canManageTask(task: NotificationTaskRecord) {
    if (task.owner.user_id === me?.id) return true
    if (me?.role === 'owner') return true
    return me?.role === 'admin' && task.owner.role === 'member'
  }

  function canEditChannels(task: NotificationTaskRecord) {
    return task.owner.user_id === me?.id
  }

  async function handleToggle(task: NotificationTaskRecord) {
    try {
      await apiPatch(`/api/settings/notification-tasks/${task.id}`, { enabled: task.enabled !== 1 })
      await mutate()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('modal.genericError') })
    }
  }

  async function handleDelete(taskId: number) {
    try {
      await apiDelete(`/api/settings/notification-tasks/${taskId}`)
      await mutate()
      if (form?.id === taskId) setForm(null)
      setMessage({ type: 'success', text: t('notifications.taskDeleted') })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('modal.genericError') })
    }
  }

  async function handleSubmit(task: NotificationTaskRecord) {
    if (!form || saving) return

    const ownTask = canEditChannels(task)
    const parsed = validateNotificationRuleForm(form, t)
    if (!parsed.values) {
      setMessage({ type: 'error', text: parsed.error ?? t('modal.genericError') })
      return
    }

    const payload: Record<string, unknown> = {
      enabled: form.enabled,
      delivery_mode: form.delivery_mode,
      content_mode: form.content_mode,
      translate_enabled: form.translate_enabled,
      check_interval_minutes: parsed.values.check_interval_minutes,
      max_articles_per_message: parsed.values.max_articles_per_message,
      max_title_chars: parsed.values.max_title_chars,
      max_body_chars: parsed.values.max_body_chars,
    }
    if (ownTask) {
      payload.channel_ids = form.channel_ids
    }

    setSaving(true)
    try {
      await apiPatch(`/api/settings/notification-tasks/${task.id}`, payload)
      await mutate()
      setForm(null)
      setMessage({ type: 'success', text: t('notifications.taskSaved') })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t('modal.genericError') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text mb-1">{t('notifications.tasksTitle')}</h2>
          <p className="text-xs text-muted">{t('notifications.tasksDesc')}</p>
        </div>
        {isAdminLike && (
          <div className="inline-flex rounded-lg border border-border bg-bg-card p-1">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${scope === 'all' ? 'bg-hover-sidebar text-text font-medium' : 'text-muted hover:text-text'}`}
            >
              {t('notifications.scopeAll')}
            </button>
            <button
              type="button"
              onClick={() => setScope('self')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${scope === 'self' ? 'bg-hover-sidebar text-text font-medium' : 'text-muted hover:text-text'}`}
            >
              {t('notifications.scopeMine')}
            </button>
          </div>
        )}
      </div>

      {sortedTasks.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-bg-card px-4 py-6 text-sm text-muted flex items-center gap-3">
          <BellRing size={18} className="shrink-0" />
          {t('notifications.tasksEmpty')}
        </div>
      )}

      {sortedTasks.length > 0 && (
        <div className="space-y-3">
          {sortedTasks.map(task => {
            const editing = form?.id === task.id
            const canManage = canManageTask(task)
            const allowChannelEdit = canEditChannels(task)
            return (
              <div key={task.id} className="rounded-lg border border-border bg-bg-card p-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${task.enabled === 1 ? 'bg-success' : 'bg-muted'}`} />
                      <span className="min-w-0 text-sm font-medium text-text break-words sm:truncate">{task.feed.name}</span>
                      {task.translate_enabled === 1 && (
                        <span className="text-[11px] text-muted rounded-full border border-border px-1.5 py-0.5">
                          {t('notifications.translateBadge')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {t('notifications.taskOwner')}: {task.owner.email ?? t('notifications.ownerLocal')}
                    </p>
                    <div className="mt-2 grid gap-1 text-xs text-muted md:grid-cols-2">
                      <p>{t('notifications.taskMode')}: {task.delivery_mode === 'immediate' ? t('notifications.deliveryModeImmediate') : t('notifications.deliveryModeDigest')}</p>
                      <p>{t('notifications.taskContentMode')}: {task.content_mode === 'title_only' ? t('notifications.contentModeTitleOnly') : t('notifications.contentModeTitleAndBody')}</p>
                      {task.delivery_mode === 'digest'
                        ? <p>{t('notifications.taskInterval')}: {task.check_interval_minutes}{t('notifications.taskMinutesSuffix')}</p>
                        : <p>{t('notifications.taskNextRetry')}: {formatLocalDateTime(task.next_check_at, t('notifications.neverChecked'))}</p>}
                      <p>{t('notifications.taskMaxArticles')}: {task.max_articles_per_message}</p>
                      <p>{t('notifications.taskLengthSummary', { title: String(task.max_title_chars), body: String(task.max_body_chars) })}</p>
                      <p>{t('notifications.taskLastCheck')}: {formatLocalDateTime(task.last_checked_at, t('notifications.neverChecked'))}</p>
                      <p>{t('notifications.taskChannels')}: {task.channels.length > 0 ? task.channels.map(channel => channel.name).join(' / ') : t('notifications.noChannelsBound')}</p>
                    </div>
                    {task.last_error && (
                      <p className="mt-2 text-xs text-error break-words">
                        {t('notifications.taskLastError')}: {task.last_error}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => void handleToggle(task)}
                        className="px-2 py-1 text-xs rounded-md border border-border text-muted hover:text-text hover:bg-hover transition-colors"
                      >
                        {task.enabled === 1 ? t('notifications.disable') : t('notifications.enable')}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(task)}
                        className="px-2 py-1 text-xs rounded-md border border-border text-muted hover:text-text hover:bg-hover transition-colors"
                        aria-label={t('notifications.taskEdit')}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(task.id)}
                        className="px-2 py-1 text-xs rounded-md border border-border text-error hover:bg-hover transition-colors"
                        aria-label={t('notifications.taskDelete')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {editing && form && (
                  <div className="rounded-lg border border-border bg-bg-subtle p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-medium text-text">{t('notifications.taskEdit')}</h3>
                      <button
                        type="button"
                        onClick={() => setForm(null)}
                        className="text-xs text-muted hover:text-text transition-colors"
                      >
                        {t('settings.cancel')}
                      </button>
                    </div>

                    <NotificationRuleEditor
                      feedName={task.feed.name}
                      form={form}
                      onChange={next => setForm({ ...next, id: task.id })}
                      availableChannels={availableChannels}
                      allowChannelEdit={allowChannelEdit}
                      readOnlyChannelsText={task.channels.length > 0 ? task.channels.map(channel => channel.name).join(' / ') : t('notifications.noChannelsBound')}
                      readOnlyChannelsHint={!allowChannelEdit ? t('notifications.crossUserChannelReadonly') : null}
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSubmit(task)}
                        disabled={saving}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {saving ? '...' : t('settings.save')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.type === 'success' ? 'text-accent' : 'text-error'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
