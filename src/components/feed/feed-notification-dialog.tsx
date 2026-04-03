import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { apiDelete, apiPut, fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import type { FeedWithCounts, NotificationChannel, FeedNotificationRuleRecord } from '../../../shared/types'
import {
  DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES,
  DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
  DEFAULT_NOTIFICATION_MAX_BODY_CHARS,
  DEFAULT_NOTIFICATION_MAX_TITLE_CHARS,
} from '../../../shared/notification-message'
import {
  NotificationRuleEditor,
  type NotificationRuleFormState,
  validateNotificationRuleForm,
} from '../notifications/notification-rule-editor'

interface FeedNotificationDialogProps {
  feed: FeedWithCounts
  onClose: () => void
}

function createDefaultFormState(): NotificationRuleFormState {
  return {
    enabled: false,
    delivery_mode: 'immediate',
    content_mode: 'title_and_body',
    translate_enabled: false,
    check_interval_minutes: String(DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES),
    max_articles_per_message: String(DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE),
    max_title_chars: String(DEFAULT_NOTIFICATION_MAX_TITLE_CHARS),
    max_body_chars: String(DEFAULT_NOTIFICATION_MAX_BODY_CHARS),
    channel_ids: [],
  }
}

export function FeedNotificationDialog({ feed, onClose }: FeedNotificationDialogProps) {
  const { t } = useI18n()
  const { data: channelData } = useSWR<{ channels: NotificationChannel[] }>(
    '/api/settings/notification-channels',
    fetcher,
    { revalidateOnFocus: false },
  )
  const { data: rule, mutate } = useSWR<FeedNotificationRuleRecord>(
    `/api/feeds/${feed.id}/notification-rule`,
    fetcher,
    { revalidateOnFocus: false },
  )
  const [form, setForm] = useState<NotificationRuleFormState>(() => createDefaultFormState())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!rule) return
    setForm({
      enabled: rule.enabled === 1,
      delivery_mode: rule.delivery_mode ?? 'immediate',
      content_mode: rule.content_mode ?? 'title_and_body',
      translate_enabled: rule.translate_enabled === 1,
      check_interval_minutes: String(rule.check_interval_minutes ?? DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES),
      max_articles_per_message: String(rule.max_articles_per_message ?? DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE),
      max_title_chars: String(rule.max_title_chars ?? DEFAULT_NOTIFICATION_MAX_TITLE_CHARS),
      max_body_chars: String(rule.max_body_chars ?? DEFAULT_NOTIFICATION_MAX_BODY_CHARS),
      channel_ids: rule.channel_ids ?? [],
    })
  }, [rule])

  const availableChannels = useMemo(
    () => (channelData?.channels ?? []).filter(channel => channel.enabled === 1),
    [channelData],
  )

  async function handleSave() {
    const parsed = validateNotificationRuleForm(form, t)
    if (!parsed.values) {
      setMessage(parsed.error ?? t('modal.genericError'))
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      await apiPut(`/api/feeds/${feed.id}/notification-rule`, {
        enabled: form.enabled,
        delivery_mode: form.delivery_mode,
        content_mode: form.content_mode,
        translate_enabled: form.translate_enabled,
        check_interval_minutes: parsed.values.check_interval_minutes,
        max_articles_per_message: parsed.values.max_articles_per_message,
        max_title_chars: parsed.values.max_title_chars,
        max_body_chars: parsed.values.max_body_chars,
        channel_ids: form.channel_ids,
      })
      await mutate()
      setMessage(t('notifications.ruleSaved'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    setMessage(null)
    try {
      await apiDelete(`/api/feeds/${feed.id}/notification-rule`)
      await mutate({
        id: null as never,
        user_id: null,
        feed_id: feed.id,
        enabled: 0,
        delivery_mode: 'immediate',
        content_mode: 'title_and_body',
        translate_enabled: 0,
        check_interval_minutes: DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES,
        max_articles_per_message: DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
        max_title_chars: DEFAULT_NOTIFICATION_MAX_TITLE_CHARS,
        max_body_chars: DEFAULT_NOTIFICATION_MAX_BODY_CHARS,
        next_check_at: null,
        last_checked_at: null,
        created_at: null as never,
        updated_at: null as never,
        channel_ids: [],
      }, { revalidate: false })
      setForm(createDefaultFormState())
      setMessage(t('notifications.ruleDeleted'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden" aria-describedby={undefined}>
        <VisuallyHidden.Root asChild>
          <DialogTitle>{t('notifications.feedDialogTitle')}</DialogTitle>
        </VisuallyHidden.Root>

        <div className="min-w-0 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-text">{t('notifications.feedDialogTitle')}</h2>
            <p className="mt-1 text-xs text-muted">{feed.name}</p>
          </div>

          <NotificationRuleEditor
            feedName={feed.name}
            form={form}
            onChange={setForm}
            availableChannels={availableChannels}
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? '...' : t('settings.save')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors"
              >
                {t('settings.cancel')}
              </button>
            </div>

            {rule?.id && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-error hover:bg-hover transition-colors disabled:opacity-50"
              >
                {t('notifications.ruleDelete')}
              </button>
            )}
          </div>

          {message && <p className="text-xs text-muted">{message}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
