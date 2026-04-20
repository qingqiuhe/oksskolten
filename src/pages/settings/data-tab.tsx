import useSWR from 'swr'
import { Construction } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import { DataSection } from './sections/data-section'
import { FetchScheduleSection } from './sections/fetch-schedule-section'
import { SocialSourcesSection } from './sections/social-sources-section'
import { RetentionSection } from './sections/retention-section'
import { Separator } from '@/components/ui/separator'
import { fetcher } from '../../lib/fetcher'

function PlaceholderSection({ titleKey, descKey }: { titleKey: string; descKey: string }) {
  const { t } = useI18n()
  return (
    <section className="opacity-50">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-semibold text-text">{t(titleKey as 'settings.data')}</h2>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted bg-hover select-none">
          <Construction size={10} />
          {t('settings.comingSoon')}
        </span>
      </div>
      <p className="text-xs text-muted">{t(descKey as 'settings.data')}</p>
    </section>
  )
}

export function DataTab() {
  const { data: me } = useSWR<{ id: number; role?: 'owner' | 'admin' | 'member' }>('/api/me', fetcher)
  const isAdminLike = me?.role === 'owner' || me?.role === 'admin'

  return (
    <>
      <DataSection />
      <Separator />
      {isAdminLike && (
        <>
          <SocialSourcesSection />
          <Separator />
        </>
      )}
      <FetchScheduleSection />
      <Separator />
      <PlaceholderSection titleKey="settings.dbBackup" descKey="settings.dbBackupDesc" />
      <Separator />
      <RetentionSection />
    </>
  )
}
