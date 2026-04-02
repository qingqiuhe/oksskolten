import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { FormField } from '../ui/form-field'
import { Input } from '../ui/input'
import { fetcher, apiDelete, apiPut } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'
import type { FeedWithCounts, NotificationChannel, FeedNotificationRuleRecord } from '../../../shared/types'

interface FeedNotificationDialogProps {
  feed: FeedWithCounts
  onClose: () => void
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
  const [enabled, setEnabled] = useState(false)
  const [deliveryMode, setDeliveryMode] = useState<'immediate' | 'digest'>('immediate')
  const [contentMode, setContentMode] = useState<'title_only' | 'title_and_body'>('title_and_body')
  const [translateEnabled, setTranslateEnabled] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [maxArticlesPerMessage, setMaxArticlesPerMessage] = useState('5')
  const [selectedChannelIds, setSelectedChannelIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!rule) return
    setEnabled(rule.enabled === 1)
    setDeliveryMode(rule.delivery_mode ?? 'immediate')
    setContentMode(rule.content_mode ?? 'title_and_body')
    setTranslateEnabled(rule.translate_enabled === 1)
    setIntervalMinutes(String(rule.check_interval_minutes ?? 60))
    setMaxArticlesPerMessage(String(rule.max_articles_per_message ?? 5))
    setSelectedChannelIds(rule.channel_ids ?? [])
  }, [rule])

  const availableChannels = useMemo(
    () => (channelData?.channels ?? []).filter(channel => channel.enabled === 1),
    [channelData],
  )

  function toggleChannel(channelId: number) {
    setSelectedChannelIds(current =>
      current.includes(channelId)
        ? current.filter(id => id !== channelId)
        : [...current, channelId],
    )
  }

  async function handleSave() {
    const maxArticles = Number(maxArticlesPerMessage)
    if (!Number.isInteger(maxArticles) || maxArticles < 1 || maxArticles > 20) {
      setMessage(t('notifications.maxArticlesInvalid'))
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      await apiPut(`/api/feeds/${feed.id}/notification-rule`, {
        enabled,
        delivery_mode: deliveryMode,
        content_mode: contentMode,
        translate_enabled: translateEnabled,
        check_interval_minutes: Number(intervalMinutes),
        max_articles_per_message: maxArticles,
        channel_ids: selectedChannelIds,
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
        check_interval_minutes: 60,
        max_articles_per_message: 5,
        next_check_at: null,
        last_checked_at: null,
        created_at: null as never,
        updated_at: null as never,
        channel_ids: [],
      }, { revalidate: false })
      setEnabled(false)
      setDeliveryMode('immediate')
      setContentMode('title_and_body')
      setTranslateEnabled(false)
      setSelectedChannelIds([])
      setIntervalMinutes('60')
      setMaxArticlesPerMessage('5')
      setMessage(t('notifications.ruleDeleted'))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('modal.genericError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden" aria-describedby={undefined}>
        <VisuallyHidden.Root asChild><DialogTitle>{t('notifications.feedDialogTitle')}</DialogTitle></VisuallyHidden.Root>
        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-text">{t('notifications.feedDialogTitle')}</h2>
            <p className="mt-1 text-xs text-muted">{feed.name}</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="accent-accent"
            />
            {t('notifications.ruleEnabled')}
          </label>

          <div>
            <p className="text-xs text-muted mb-2">{t('notifications.feedDialogMode')}</p>
            <div className="inline-flex rounded-lg border border-border bg-bg-card p-1">
              <button
                type="button"
                onClick={() => setDeliveryMode('immediate')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  deliveryMode === 'immediate' ? 'bg-hover-sidebar text-text font-medium' : 'text-muted hover:text-text'
                }`}
              >
                {t('notifications.deliveryModeImmediate')}
              </button>
              <button
                type="button"
                onClick={() => setDeliveryMode('digest')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  deliveryMode === 'digest' ? 'bg-hover-sidebar text-text font-medium' : 'text-muted hover:text-text'
                }`}
              >
                {t('notifications.deliveryModeDigest')}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {deliveryMode === 'immediate'
                ? t('notifications.feedDialogImmediateHint')
                : t('notifications.feedDialogDigestHint')}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted mb-2">{t('notifications.feedDialogContentMode')}</p>
            <div className="inline-flex rounded-lg border border-border bg-bg-card p-1">
              <button
                type="button"
                onClick={() => setContentMode('title_only')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  contentMode === 'title_only' ? 'bg-hover-sidebar text-text font-medium' : 'text-muted hover:text-text'
                }`}
              >
                {t('notifications.contentModeTitleOnly')}
              </button>
              <button
                type="button"
                onClick={() => setContentMode('title_and_body')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  contentMode === 'title_and_body' ? 'bg-hover-sidebar text-text font-medium' : 'text-muted hover:text-text'
                }`}
              >
                {t('notifications.contentModeTitleAndBody')}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">{t('notifications.feedDialogContentModeHint')}</p>
          </div>

          <div className="rounded-lg border border-border bg-bg-subtle px-3 py-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div className="min-w-0">
                <div className="text-sm text-text">{t('notifications.translateEnabled')}</div>
                <p className="mt-1 text-xs text-muted">{t('notifications.translateEnabledHint')}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={translateEnabled}
                onClick={() => setTranslateEnabled(value => !value)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  translateEnabled ? 'bg-accent' : 'bg-border'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                    translateEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          </div>

          <FormField label={t('notifications.maxArticlesPerMessage')} compact hint={t('notifications.maxArticlesPerMessageHint')}>
            <Input
              type="number"
              min={1}
              max={20}
              step={1}
              value={maxArticlesPerMessage}
              onChange={e => setMaxArticlesPerMessage(e.target.value)}
            />
          </FormField>

          <div>
            <p className="text-xs text-muted mb-2">{t('notifications.feedDialogChannels')}</p>
            {availableChannels.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted">
                {t('notifications.feedDialogNoChannels')}
              </div>
            ) : (
              <div className="space-y-2">
                {availableChannels.map(channel => (
                  <label
                    key={channel.id}
                    className="flex w-full min-w-0 items-start gap-2 rounded-lg border border-border bg-bg-subtle px-3 py-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannelIds.includes(channel.id)}
                      onChange={() => toggleChannel(channel.id)}
                      className="mt-0.5 accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text truncate">{channel.name}</div>
                      <div className="block text-xs text-muted truncate">{channel.webhook_url}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {deliveryMode === 'digest' && (
            <div>
              <label className="block text-xs text-muted mb-1">{t('notifications.feedDialogInterval')}</label>
              <Input
                type="number"
                min={5}
                max={1440}
                step={5}
                value={intervalMinutes}
                onChange={e => setIntervalMinutes(e.target.value)}
              />
            </div>
          )}

          <div className="min-w-0 rounded-lg border border-border bg-bg-subtle px-3 py-3">
            <p className="text-xs font-medium text-text mb-1">{t('notifications.previewTitle')}</p>
            <p className="text-xs text-muted whitespace-pre-line break-words">
              {contentMode === 'title_only'
                ? t('notifications.previewBodyTitleOnly', { feedName: feed.name, count: maxArticlesPerMessage || '5' })
                : t('notifications.previewBodyTitleAndBody', { feedName: feed.name, count: maxArticlesPerMessage || '5' })}
            </p>
          </div>

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
