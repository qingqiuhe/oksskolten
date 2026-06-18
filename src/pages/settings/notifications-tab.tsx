import useSWR from 'swr'
import { Separator } from '@/components/ui/separator'
import { NotificationChannelsSection } from './sections/notification-channels-section'
import { NotificationTasksSection } from './sections/notification-tasks-section'
import { useI18n } from '../../lib/i18n'
import { fetcher } from '../../lib/fetcher'
import type { NotificationChannel } from '../../../shared/types'

export function NotificationsTab({ me }: { me?: { id: number; role?: 'owner' | 'admin' | 'member' } } = {}) {
  const { t } = useI18n()
  const { data: channelData, mutate: mutateChannels } = useSWR<{ channels: NotificationChannel[] }>(
    '/api/settings/notification-channels',
    fetcher,
    { revalidateOnFocus: false },
  )

  return (
    <>
      <NotificationChannelsSection t={t} sharedData={{
        channelData,
        mutateChannels,
      }} />
      <Separator />
      <NotificationTasksSection sharedData={{
        me,
        channelData,
      }} />
    </>
  )
}
