import type { ReactNode } from 'react'
import { useI18n } from '../../lib/i18n'
import type { HighValueArticle, HighValueGroupItem } from '../../../shared/types'
import { HighValueReasonChips } from './high-value-reason-chips'

interface HighValueGroupCardProps {
  item: HighValueGroupItem
  expanded: boolean
  onToggle: () => void
  renderArticle: (article: HighValueArticle, options?: { featured?: boolean; nested?: boolean }) => ReactNode
}

export function HighValueGroupCard({ item, expanded, onToggle, renderArticle }: HighValueGroupCardProps) {
  const { t } = useI18n()
  const extraMembers = item.members.filter(member => member.id !== item.display_article.id)

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
      {renderArticle(item.display_article)}
      <div className="border-t border-border px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">
              {t('inbox.section.groupCount', { count: String(item.similar_count) })}
            </p>
            {item.source_names.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                {item.source_names.slice(0, 3).join(' · ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex shrink-0 rounded-full border border-border bg-bg px-3 py-1.5 text-sm text-muted transition hover:text-text"
          >
            {expanded ? t('inbox.section.collapse') : t('inbox.section.expand')}
          </button>
        </div>
        <HighValueReasonChips reasons={item.display_article.inbox_reason_codes} />
      </div>
      {expanded && extraMembers.length > 0 && (
        <div className="border-t border-border bg-bg-subtle/40">
          {extraMembers.map(member => (
            <div key={member.id}>
              {renderArticle(member, { nested: true })}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
