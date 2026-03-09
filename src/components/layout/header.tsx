import { useI18n } from '../../lib/i18n'
import { IconButton } from '../ui/icon-button'

interface HeaderProps {
  mode: 'list' | 'detail'
  onMenuClick?: () => void
  onBack?: () => void
  feedName?: string | null
  /** Title shown centered in detail mode header */
  detailTitle?: string | null
  isScrolled?: boolean
  sidebarOpen?: boolean
}

export function Header({ mode, onMenuClick, onBack, feedName, detailTitle, isScrolled, sidebarOpen }: HeaderProps) {
  const { t } = useI18n()

  return (
    <header
      data-header
      className={`flex items-center px-4 border-b sticky top-0 z-30 backdrop-blur-md select-none transition-colors duration-200 ${
        isScrolled ? 'border-border' : 'border-transparent'
      }`}
      style={{
        height: 'var(--header-height)',
        backgroundColor: 'rgb(var(--color-bg-header-rgb) / 0.8)',
        paddingTop: 'var(--safe-area-inset-top)',
      }}
    >
      {mode === 'list' ? (
        <>
          <IconButton
            size="lg"
            onClick={onMenuClick}
            className={`text-text hover:text-text ${sidebarOpen ? 'md:invisible' : ''}`}
            aria-label={t('header.menu')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </IconButton>
          <div className="flex-1 flex justify-center">
            {feedName && (
              <span className="text-[15px] font-semibold text-text">
                {feedName}
              </span>
            )}
          </div>
          <span className="w-8" />
        </>
      ) : (
        <>
          <IconButton
            size="lg"
            onClick={onBack ?? (() => history.back())}
            className="text-text hover:text-text"
            aria-label={t('header.back')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13 4l-6 6 6 6" />
            </svg>
          </IconButton>
          <div className="flex-1 flex justify-center min-w-0">
            {detailTitle && (
              <span className="text-[15px] font-semibold text-text truncate max-w-[60vw]">
                {detailTitle}
              </span>
            )}
          </div>
          <span className="w-8" />
        </>
      )}
    </header>
  )
}
