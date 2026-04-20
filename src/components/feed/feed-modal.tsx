import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { IconButton } from '../ui/icon-button'
import { Rss, FolderPlus, Globe, ChevronLeft, X, Braces, Share2, AtSign } from 'lucide-react'
import { FeedStep } from './feed-step'
import { FolderStep } from './folder-step'
import { ArticleStep } from './article-step'
import { JsonApiFeedStep } from './json-api-feed-step'
import { SocialFeedStep } from './social-feed-step'
import type { Category } from '../../../shared/types'

interface FeedModalProps {
  onClose: () => void
  onCreated: () => void
  onCategoryCreated?: () => void
  onFetchStarted?: (feedId: number) => void
  onArticleCreated?: () => void
  categories?: Category[]
  canUseJsonApi?: boolean
}

type ModalStep = 'select' | 'feed' | 'folder' | 'article' | 'jsonApi' | 'social' | 'socialX'

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton size="sm" onClick={onClick}>
      <ChevronLeft size={16} strokeWidth={1.5} />
    </IconButton>
  )
}

export function FeedModal({ onClose, onCreated, onCategoryCreated, onFetchStarted, onArticleCreated, categories = [], canUseJsonApi = false }: FeedModalProps) {
  const { t } = useI18n()
  const [step, setStep] = useState<ModalStep>('select')

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={step === 'jsonApi' ? 'max-w-3xl' : 'max-w-sm'} aria-describedby={undefined}>
      <VisuallyHidden.Root asChild><DialogTitle>Modal</DialogTitle></VisuallyHidden.Root>
      {step === 'select' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">{t('modal.addNew')}</h2>
            <IconButton size="sm" onClick={onClose}>
              <X size={16} strokeWidth={1.5} />
            </IconButton>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setStep('feed')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <Rss size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('modal.addFeedOption')}</div>
                <div className="text-xs text-muted">{t('modal.addFeedDesc')}</div>
              </div>
            </button>
            {canUseJsonApi && (
              <button
                onClick={() => setStep('jsonApi')}
                className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
                >
                  <Braces size={18} strokeWidth={1.5} className="text-accent" />
                </div>
                <div>
                  <div className="text-sm font-medium text-text">{t('modal.addJsonApiOption')}</div>
                  <div className="text-xs text-muted">{t('modal.addJsonApiDesc')}</div>
                </div>
              </button>
            )}
            <button
              onClick={() => setStep('social')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <Share2 size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('modal.addSocialOption')}</div>
                <div className="text-xs text-muted">{t('modal.addSocialDesc')}</div>
              </div>
            </button>
            <button
              onClick={() => setStep('article')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <Globe size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('modal.clipArticleOption')}</div>
                <div className="text-xs text-muted">{t('modal.clipArticleDesc')}</div>
              </div>
            </button>
            <button
              onClick={() => setStep('folder')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <FolderPlus size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('modal.addFolderOption')}</div>
                <div className="text-xs text-muted">{t('modal.addFolderDesc')}</div>
              </div>
            </button>
          </div>
        </>
      )}

      {step === 'feed' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <BackButton onClick={() => setStep('select')} />
            <h2 className="text-base font-semibold">{t('modal.addFeed')}</h2>
          </div>
          <FeedStep
            onClose={onClose}
            onCreated={onCreated}
            onFetchStarted={onFetchStarted}
            categories={categories}
          />
        </>
      )}

      {step === 'article' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <BackButton onClick={() => setStep('select')} />
            <h2 className="text-base font-semibold">{t('feeds.clipArticle')}</h2>
          </div>
          <ArticleStep
            onClose={onClose}
            onCreated={onCreated}
            onArticleCreated={onArticleCreated}
          />
        </>
      )}

      {step === 'jsonApi' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <BackButton onClick={() => setStep('select')} />
            <h2 className="text-base font-semibold">{t('modal.addJsonApi')}</h2>
          </div>
          <JsonApiFeedStep
            onClose={onClose}
            onCreated={onCreated}
            onFetchStarted={onFetchStarted}
            categories={categories}
          />
        </>
      )}

      {step === 'social' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <BackButton onClick={() => setStep('select')} />
            <h2 className="text-base font-semibold">{t('modal.addSocial')}</h2>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setStep('socialX')}
              className="w-full p-3 rounded-xl border border-border hover:border-accent hover:bg-hover transition-colors text-left flex items-center gap-3"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
              >
                <AtSign size={18} strokeWidth={1.5} className="text-accent" />
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t('socialFeed.platformX')}</div>
                <div className="text-xs text-muted">{t('socialFeed.platformXDesc')}</div>
              </div>
            </button>
          </div>
        </>
      )}

      {step === 'socialX' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <BackButton onClick={() => setStep('social')} />
            <h2 className="text-base font-semibold">{t('socialFeed.addXFeed')}</h2>
          </div>
          <SocialFeedStep
            onClose={onClose}
            onCreated={onCreated}
            onFetchStarted={onFetchStarted}
            categories={categories}
          />
        </>
      )}

      {step === 'folder' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <BackButton onClick={() => setStep('select')} />
            <h2 className="text-base font-semibold">{t('modal.addFolder')}</h2>
          </div>
          <FolderStep
            onClose={onClose}
            onCategoryCreated={onCategoryCreated}
          />
        </>
      )}
      </DialogContent>
    </Dialog>
  )
}
