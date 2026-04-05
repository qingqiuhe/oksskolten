import { useMemo, useState } from 'react'
import { ChevronDown, CircleHelp } from 'lucide-react'
import { useI18n, type TranslateFn } from '../../lib/i18n'
import { FormField } from '../ui/form-field'
import { Input } from '../ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'
import type { NotificationChannel } from '../../../shared/types'
import {
  DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES,
  DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
  DEFAULT_NOTIFICATION_MAX_BODY_CHARS,
  DEFAULT_NOTIFICATION_MAX_TITLE_CHARS,
  MAX_NOTIFICATION_CHECK_INTERVAL_MINUTES,
  MAX_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
  MAX_NOTIFICATION_MAX_BODY_CHARS,
  MAX_NOTIFICATION_MAX_TITLE_CHARS,
  MIN_NOTIFICATION_CHECK_INTERVAL_MINUTES,
  MIN_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE,
  MIN_NOTIFICATION_MAX_BODY_CHARS,
  MIN_NOTIFICATION_MAX_TITLE_CHARS,
} from '../../../shared/notification-message'

export interface NotificationRuleFormState {
  enabled: boolean
  delivery_mode: 'immediate' | 'digest'
  content_mode: 'title_only' | 'title_and_body'
  translate_enabled: boolean
  check_interval_minutes: string
  max_articles_per_message: string
  max_title_chars: string
  max_body_chars: string
  channel_ids: number[]
}

export interface ParsedNotificationRuleFormValues {
  check_interval_minutes: number
  max_articles_per_message: number
  max_title_chars: number
  max_body_chars: number
}

interface NotificationRuleEditorProps {
  feedName: string
  form: NotificationRuleFormState
  onChange: (next: NotificationRuleFormState) => void
  availableChannels: Array<Pick<NotificationChannel, 'id' | 'name' | 'webhook_url'>>
  allowChannelEdit?: boolean
  readOnlyChannelsText?: string
  readOnlyChannelsHint?: string | null
}

function parseIntegerField(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

function buildPreviewCopy(form: NotificationRuleFormState, feedName: string, t: TranslateFn) {
  const maxArticles = parseIntegerField(form.max_articles_per_message, DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE)
  const maxTitleChars = parseIntegerField(form.max_title_chars, DEFAULT_NOTIFICATION_MAX_TITLE_CHARS)
  const maxBodyChars = parseIntegerField(form.max_body_chars, DEFAULT_NOTIFICATION_MAX_BODY_CHARS)
  const translationLabel = form.translate_enabled
    ? t('notifications.previewTranslationWhenNeeded')
    : t('notifications.previewTranslationOff')

  const lines = form.content_mode === 'title_only'
    ? [
        t('notifications.previewHeader', { feedName, count: String(maxArticles) }),
        t('notifications.previewBodyTitleOnly', { titleChars: String(maxTitleChars) }),
      ]
    : [
        t('notifications.previewHeader', { feedName, count: String(maxArticles) }),
        t('notifications.previewBodyTitleAndBody', {
          titleChars: String(maxTitleChars),
          bodyChars: String(maxBodyChars),
          translation: translationLabel,
        }),
      ]

  return lines
}

function buildAdvancedSummary(form: NotificationRuleFormState, t: TranslateFn): string[] {
  const chips = [
    t('notifications.advancedSummaryArticles', {
      value: String(parseIntegerField(form.max_articles_per_message, DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE)),
    }),
    t('notifications.advancedSummaryTitle', {
      value: String(parseIntegerField(form.max_title_chars, DEFAULT_NOTIFICATION_MAX_TITLE_CHARS)),
    }),
  ]

  if (form.delivery_mode === 'digest') {
    chips.unshift(t('notifications.advancedSummaryInterval', {
      value: String(parseIntegerField(form.check_interval_minutes, DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES)),
    }))
  }

  if (form.content_mode === 'title_and_body') {
    chips.push(
      t('notifications.advancedSummaryBody', {
        value: String(parseIntegerField(form.max_body_chars, DEFAULT_NOTIFICATION_MAX_BODY_CHARS)),
      }),
      form.translate_enabled
        ? t('notifications.advancedSummaryTranslateOn')
        : t('notifications.advancedSummaryTranslateOff'),
    )
  }

  return chips
}

function SmallSwitch({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean
  onToggle: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full border border-transparent transition-colors',
        checked ? 'bg-accent' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}

export function validateNotificationRuleForm(form: NotificationRuleFormState, t: TranslateFn): {
  values?: ParsedNotificationRuleFormValues
  error?: string
} {
  const interval = Number(form.check_interval_minutes)
  if (!Number.isInteger(interval) || interval < MIN_NOTIFICATION_CHECK_INTERVAL_MINUTES || interval > MAX_NOTIFICATION_CHECK_INTERVAL_MINUTES) {
    return { error: t('notifications.taskIntervalInvalid') }
  }

  const maxArticles = Number(form.max_articles_per_message)
  if (!Number.isInteger(maxArticles) || maxArticles < MIN_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE || maxArticles > MAX_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE) {
    return { error: t('notifications.maxArticlesInvalid') }
  }

  const maxTitleChars = Number(form.max_title_chars)
  if (!Number.isInteger(maxTitleChars) || maxTitleChars < MIN_NOTIFICATION_MAX_TITLE_CHARS || maxTitleChars > MAX_NOTIFICATION_MAX_TITLE_CHARS) {
    return { error: t('notifications.maxTitleCharsInvalid') }
  }

  const maxBodyChars = Number(form.max_body_chars)
  if (!Number.isInteger(maxBodyChars) || maxBodyChars < MIN_NOTIFICATION_MAX_BODY_CHARS || maxBodyChars > MAX_NOTIFICATION_MAX_BODY_CHARS) {
    return { error: t('notifications.maxBodyCharsInvalid') }
  }

  return {
    values: {
      check_interval_minutes: interval,
      max_articles_per_message: maxArticles,
      max_title_chars: maxTitleChars,
      max_body_chars: maxBodyChars,
    },
  }
}

export function NotificationRuleEditor({
  feedName,
  form,
  onChange,
  availableChannels,
  allowChannelEdit = true,
  readOnlyChannelsText,
  readOnlyChannelsHint,
}: NotificationRuleEditorProps) {
  const { t } = useI18n()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewLines = useMemo(() => buildPreviewCopy(form, feedName, t), [feedName, form, t])
  const summaryChips = useMemo(() => buildAdvancedSummary(form, t), [form, t])

  function setField<K extends keyof NotificationRuleFormState>(key: K, value: NotificationRuleFormState[K]) {
    onChange({ ...form, [key]: value })
  }

  function toggleChannel(channelId: number) {
    setField(
      'channel_ids',
      form.channel_ids.includes(channelId)
        ? form.channel_ids.filter(id => id !== channelId)
        : [...form.channel_ids, channelId],
    )
  }

  const previewBody = (
    <div className="space-y-1.5 text-left">
      {previewLines.map(line => (
        <p key={line} className="text-xs leading-5 text-text whitespace-pre-line">
          {line}
        </p>
      ))}
    </div>
  )

  const sectionHeadingClass = 'text-sm font-medium text-text'
  const sectionHintClass = 'mt-1 text-xs text-muted'

  return (
    <div className="space-y-4">
      <section
        className={cn(
          'rounded-lg border bg-bg-card p-4 transition-colors',
          form.enabled
            ? 'border-accent/25'
            : 'border-border',
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className={sectionHeadingClass}>{t('notifications.ruleEnabled')}</h3>
              <span
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs font-medium',
                  form.enabled
                    ? 'border-accent/30 bg-accent/10 text-text'
                    : 'border-border bg-bg-subtle text-muted',
                )}
              >
                {form.enabled ? t('notifications.ruleStatusEnabled') : t('notifications.ruleStatusPaused')}
              </span>
            </div>
            <p className={sectionHintClass}>{t('notifications.ruleEnabledHint')}</p>
          </div>

          <button
            type="button"
            role="switch"
            aria-label={t('notifications.ruleEnabled')}
            aria-checked={form.enabled}
            onClick={() => setField('enabled', !form.enabled)}
            className={cn(
              'relative inline-flex h-8 w-14 shrink-0 rounded-full border transition-colors',
              form.enabled ? 'border-accent/20 bg-accent' : 'border-border bg-border',
            )}
          >
            <span
              className={cn(
                'pointer-events-none absolute top-0.5 left-0.5 h-7 w-7 rounded-full bg-white shadow-md transition-transform',
                form.enabled ? 'translate-x-6' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-card p-4">
        <div className="mb-4">
          <h3 className={sectionHeadingClass}>{t('notifications.basicSettingsTitle')}</h3>
          <p className={sectionHintClass}>{t('notifications.basicSettingsHint')}</p>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs text-muted">{t('notifications.feedDialogMode')}</p>
            <div className="inline-flex rounded-lg border border-border bg-bg-subtle p-1">
              <button
                type="button"
                onClick={() => setField('delivery_mode', 'immediate')}
                className={cn(
                  'rounded-md px-3 py-2 text-xs transition-colors',
                  form.delivery_mode === 'immediate'
                    ? 'bg-bg-card font-medium text-text shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('notifications.deliveryModeImmediate')}
              </button>
              <button
                type="button"
                onClick={() => setField('delivery_mode', 'digest')}
                className={cn(
                  'rounded-md px-3 py-2 text-xs transition-colors',
                  form.delivery_mode === 'digest'
                    ? 'bg-bg-card font-medium text-text shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('notifications.deliveryModeDigest')}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {form.delivery_mode === 'immediate'
                ? t('notifications.feedDialogImmediateHint')
                : t('notifications.feedDialogDigestHint')}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-xs text-muted">{t('notifications.feedDialogContentMode')}</p>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(open => !open)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent/30 hover:text-text"
                      aria-label={t('notifications.previewTrigger')}
                    >
                      <CircleHelp size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="hidden max-w-[20rem] md:block">
                    {previewBody}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="inline-flex rounded-lg border border-border bg-bg-subtle p-1">
              <button
                type="button"
                onClick={() => setField('content_mode', 'title_only')}
                className={cn(
                  'rounded-md px-3 py-2 text-xs transition-colors',
                  form.content_mode === 'title_only'
                    ? 'bg-bg-card font-medium text-text shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('notifications.contentModeTitleOnly')}
              </button>
              <button
                type="button"
                onClick={() => setField('content_mode', 'title_and_body')}
                className={cn(
                  'rounded-md px-3 py-2 text-xs transition-colors',
                  form.content_mode === 'title_and_body'
                    ? 'bg-bg-card font-medium text-text shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('notifications.contentModeTitleAndBody')}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">{t('notifications.feedDialogContentModeHint')}</p>

            {previewOpen && (
              <div className="mt-3 rounded-lg border border-border bg-bg-subtle p-3 md:hidden">
                {previewBody}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs text-muted">{t('notifications.feedDialogChannels')}</p>
            {allowChannelEdit ? (
              availableChannels.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted">
                  {t('notifications.feedDialogNoChannels')}
                </div>
              ) : (
                <div className="space-y-2">
                  {availableChannels.map(channel => (
                    <label
                      key={channel.id}
                      className="flex w-full min-w-0 items-start gap-3 rounded-lg border border-border bg-bg-subtle px-3 py-3 cursor-pointer transition-colors hover:border-accent/20 hover:bg-bg-card"
                    >
                      <input
                        type="checkbox"
                        checked={form.channel_ids.includes(channel.id)}
                        onChange={() => toggleChannel(channel.id)}
                        className="mt-0.5 accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text">{channel.name}</div>
                        <div className="truncate text-xs text-muted">{channel.webhook_url}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg border border-border bg-bg-subtle px-3 py-3 text-xs text-muted">
                  {readOnlyChannelsText || t('notifications.noChannelsBound')}
                </div>
                {readOnlyChannelsHint && (
                  <p className="text-xs text-muted">{readOnlyChannelsHint}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-card">
        <button
          type="button"
          onClick={() => setAdvancedOpen(open => !open)}
          aria-label={t('notifications.advancedSettingsTitle')}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
        >
          <div className="min-w-0">
            <h3 className={sectionHeadingClass}>{t('notifications.advancedSettingsTitle')}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {summaryChips.map(chip => (
                <span
                  key={chip}
                  className="rounded-md border border-border bg-bg-subtle px-2 py-1 text-xs text-muted"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <ChevronDown
            size={16}
            className={cn('shrink-0 text-muted transition-transform', advancedOpen && 'rotate-180')}
          />
        </button>

        {advancedOpen && (
          <div className="border-t border-border px-4 pb-4 pt-4">
            <div className="space-y-4">
              {form.content_mode === 'title_and_body' && (
                <div className="rounded-lg border border-border bg-bg-subtle px-3 py-3">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div className="min-w-0">
                      <div className="text-sm text-text">{t('notifications.translateEnabled')}</div>
                      <p className="mt-1 text-xs leading-5 text-muted">{t('notifications.translateEnabledHint')}</p>
                    </div>
                    <SmallSwitch
                      checked={form.translate_enabled}
                      onToggle={() => setField('translate_enabled', !form.translate_enabled)}
                      ariaLabel={t('notifications.translateEnabled')}
                    />
                  </label>
                </div>
              )}

              {form.delivery_mode === 'digest' && (
                <FormField
                  label={t('notifications.feedDialogInterval')}
                  compact
                  hint={t('notifications.taskEditHint')}
                >
                  <Input
                    type="number"
                    min={MIN_NOTIFICATION_CHECK_INTERVAL_MINUTES}
                    max={MAX_NOTIFICATION_CHECK_INTERVAL_MINUTES}
                    step={5}
                    value={form.check_interval_minutes}
                    onChange={event => setField('check_interval_minutes', event.target.value)}
                  />
                </FormField>
              )}

              <FormField
                label={t('notifications.maxArticlesPerMessage')}
                compact
                hint={t('notifications.maxArticlesPerMessageHint')}
              >
                <Input
                  type="number"
                  min={MIN_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE}
                  max={MAX_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE}
                  step={1}
                  value={form.max_articles_per_message}
                  onChange={event => setField('max_articles_per_message', event.target.value)}
                />
              </FormField>

              <FormField
                label={t('notifications.maxTitleChars')}
                compact
                hint={t('notifications.maxTitleCharsHint')}
              >
                <Input
                  type="number"
                  min={MIN_NOTIFICATION_MAX_TITLE_CHARS}
                  max={MAX_NOTIFICATION_MAX_TITLE_CHARS}
                  step={1}
                  value={form.max_title_chars}
                  onChange={event => setField('max_title_chars', event.target.value)}
                />
              </FormField>

              {form.content_mode === 'title_and_body' && (
                <FormField
                  label={t('notifications.maxBodyChars')}
                  compact
                  hint={t('notifications.maxBodyCharsHint')}
                >
                  <Input
                    type="number"
                    min={MIN_NOTIFICATION_MAX_BODY_CHARS}
                    max={MAX_NOTIFICATION_MAX_BODY_CHARS}
                    step={1}
                    value={form.max_body_chars}
                    onChange={event => setField('max_body_chars', event.target.value)}
                  />
                </FormField>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
