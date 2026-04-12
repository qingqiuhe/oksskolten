import { useState } from 'react'
import type { FeedPriorityLevel } from '../../../shared/types'
import { useI18n } from '../../lib/i18n'
import { normalizeFeedIconUrl, isValidFeedIconUrl } from '../../lib/feed-icon-url'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { FeedIconPreview } from './feed-icon-preview'
import { FeedPriorityPicker } from './feed-priority-picker'

interface FeedEditDialogProps {
  name: string
  iconUrl: string
  priorityLevel: FeedPriorityLevel
  feedUrl: string
  onNameChange: (value: string) => void
  onIconUrlChange: (value: string) => void
  onPriorityLevelChange: (value: FeedPriorityLevel) => void
  onSubmit: () => void | Promise<void>
  onClose: () => void
}

export function FeedEditDialog({
  name,
  iconUrl,
  priorityLevel,
  feedUrl,
  onNameChange,
  onIconUrlChange,
  onPriorityLevelChange,
  onSubmit,
  onClose,
}: FeedEditDialogProps) {
  const { t } = useI18n()
  const [error, setError] = useState('')

  function handleSubmit() {
    const normalizedIconUrl = normalizeFeedIconUrl(iconUrl)
    if (normalizedIconUrl && !isValidFeedIconUrl(normalizedIconUrl)) {
      setError(t('feeds.avatarUrlInvalid'))
      return
    }
    setError('')
    void onSubmit()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">{t('feeds.editFeed')}</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted" htmlFor="feed-edit-name">
              {t('feeds.rename')}
            </label>
            <Input
              id="feed-edit-name"
              autoFocus
              value={name}
              onChange={e => onNameChange(e.target.value)}
              placeholder={t('modal.namePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted" htmlFor="feed-edit-icon-url">
              {t('feeds.avatarUrl')}
            </label>
            <Input
              id="feed-edit-icon-url"
              type="url"
              value={iconUrl}
              onChange={e => {
                setError('')
                onIconUrlChange(e.target.value)
              }}
              placeholder={t('feeds.avatarUrlPlaceholder')}
            />
            <FeedIconPreview iconUrl={normalizeFeedIconUrl(iconUrl)} feedUrl={feedUrl} name={name} />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!iconUrl.trim()}
                onClick={() => {
                  setError('')
                  onIconUrlChange('')
                }}
              >
                {t('feeds.clearAvatar')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted" htmlFor="feed-edit-priority">
              {t('feeds.priority.label')}
            </label>
            <div id="feed-edit-priority">
              <FeedPriorityPicker value={priorityLevel} onChange={onPriorityLevelChange} />
            </div>
          </div>

          {error && <p className="text-xs text-error">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('settings.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {t('settings.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
