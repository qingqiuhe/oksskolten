import { useMemo } from 'react'
import { useI18n } from '../../lib/i18n'
import type { InboxReasonCode } from '../../../shared/types'

interface HighValueReasonChipsProps {
  reasons?: string[]
}

function normalizeReasonKey(reason: string): InboxReasonCode | null {
  switch (reason) {
    case 'feed_priority_high':
    case 'feed_affinity_high':
    case 'low_frequency_source':
    case 'topic_collapsed':
    case 'topic_already_covered':
    case 'original_reporting':
    case 'recent_story':
    case 'manual_priority_low':
    case 'manual_priority_must_read':
    case 'cooldown_active':
      return reason
    default:
      return null
  }
}

function reasonLabel(reason: InboxReasonCode, t: ReturnType<typeof useI18n>['t']) {
  switch (reason) {
    case 'feed_priority_high':
      return t('inbox.reason.feed_priority_high')
    case 'feed_affinity_high':
      return t('inbox.reason.feed_affinity_high')
    case 'low_frequency_source':
      return t('inbox.reason.low_frequency_source')
    case 'topic_collapsed':
      return t('inbox.reason.topic_collapsed')
    case 'topic_already_covered':
      return t('inbox.reason.topic_already_covered')
    case 'original_reporting':
      return t('inbox.reason.original_reporting')
    case 'recent_story':
      return t('inbox.reason.recent_story')
    case 'manual_priority_low':
      return t('inbox.reason.manual_priority_low')
    case 'manual_priority_must_read':
      return t('inbox.reason.manual_priority_must_read')
    case 'cooldown_active':
      return t('inbox.reason.cooldown_active')
  }
}

export function HighValueReasonChips({ reasons = [] }: HighValueReasonChipsProps) {
  const { t } = useI18n()
  const labels = useMemo(() => reasons
    .map(normalizeReasonKey)
    .filter((value): value is InboxReasonCode => value != null)
    .slice(0, 2)
    .map(reason => reasonLabel(reason, t)), [reasons, t])

  if (labels.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {labels.map(label => (
        <span
          key={label}
          className="inline-flex rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-xs text-muted"
        >
          {label}
        </span>
      ))}
    </div>
  )
}
