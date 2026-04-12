import type { ReactNode } from 'react'
import type { HighValueArticle, HighValueItem } from '../../../shared/types'
import { useI18n } from '../../lib/i18n'
import { HighValueReasonChips } from './high-value-reason-chips'
import { HighValueGroupCard } from './high-value-group-card'

interface HighValueSectionProps {
  items: HighValueItem[]
  expandedGroupIds: Set<number>
  onToggleGroup: (anchorArticleId: number) => void
  renderArticle: (article: HighValueArticle, options?: { featured?: boolean; nested?: boolean }) => ReactNode
}

export function HighValueSection({ items, expandedGroupIds, onToggleGroup, renderArticle }: HighValueSectionProps) {
  const { t } = useI18n()

  if (items.length === 0) return null

  return (
    <section className="px-4 py-4 md:px-6" data-testid="high-value-section">
      <div className="rounded-3xl border border-border bg-bg-card/80 p-4 md:p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-text">{t('inbox.section.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('inbox.section.subtitle')}</p>
          <p className="mt-1 text-xs text-muted">{t('inbox.section.remaining')}</p>
        </div>
        <div className="space-y-4">
          {items.map(item => item.kind === 'group' ? (
            <HighValueGroupCard
              key={`group-${item.anchor_article_id}`}
              item={item}
              expanded={expandedGroupIds.has(item.anchor_article_id)}
              onToggle={() => onToggleGroup(item.anchor_article_id)}
              renderArticle={renderArticle}
            />
          ) : (
            <section key={`article-${item.display_article.id}`} className="overflow-hidden rounded-2xl border border-border bg-bg-card">
              {renderArticle(item.display_article)}
              <div className="border-t border-border px-4 py-3 md:px-6">
                <HighValueReasonChips reasons={item.display_article.inbox_reason_codes} />
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}
