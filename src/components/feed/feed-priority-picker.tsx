import { ChevronDown, ChevronsDown, Sparkles, Star, StarOff } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import type { FeedPriorityLevel } from '../../../shared/types'
import { ActionChip } from '../ui/action-chip'

interface FeedPriorityOption {
  value: FeedPriorityLevel
  label: string
}

export function useFeedPriorityOptions(): FeedPriorityOption[] {
  const { t } = useI18n()
  return [
    { value: 1, label: t('feeds.priority.ignore') },
    { value: 2, label: t('feeds.priority.low') },
    { value: 3, label: t('feeds.priority.medium') },
    { value: 4, label: t('feeds.priority.high') },
    { value: 5, label: t('feeds.priority.mustRead') },
  ]
}

export function getFeedPriorityIcon(priority: FeedPriorityLevel) {
  switch (priority) {
    case 1:
      return <StarOff size={16} strokeWidth={1.5} />
    case 2:
      return <ChevronDown size={16} strokeWidth={1.5} />
    case 3:
      return <Star size={16} strokeWidth={1.5} />
    case 4:
      return <Sparkles size={16} strokeWidth={1.5} />
    case 5:
      return <ChevronsDown size={16} strokeWidth={1.5} className="rotate-180" />
  }
}

interface FeedPriorityPickerProps {
  value: FeedPriorityLevel
  onChange: (value: FeedPriorityLevel) => void
}

export function FeedPriorityPicker({ value, onChange }: FeedPriorityPickerProps) {
  const options = useFeedPriorityOptions()

  return (
    <div className="flex flex-wrap gap-2">
      {options.map(option => (
        <ActionChip
          key={option.value}
          type="button"
          active={value === option.value}
          onClick={() => onChange(option.value)}
          className={value === option.value ? 'border-accent bg-accent/10 text-accent' : undefined}
        >
          {getFeedPriorityIcon(option.value)}
          {option.label}
        </ActionChip>
      ))}
    </div>
  )
}
