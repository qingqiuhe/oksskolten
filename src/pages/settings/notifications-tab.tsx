import { Separator } from '@/components/ui/separator'
import { NotificationChannelsSection } from './sections/notification-channels-section'
import { NotificationTasksSection } from './sections/notification-tasks-section'
import { useI18n } from '../../lib/i18n'

export function NotificationsTab() {
  const { t } = useI18n()

  return (
    <>
      <NotificationChannelsSection t={t} />
      <Separator />
      <NotificationTasksSection />
    </>
  )
}
