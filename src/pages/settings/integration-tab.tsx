import { useI18n } from '../../lib/i18n'
import { useAppLayout } from '../../app'
import { Separator } from '@/components/ui/separator'
import { ProviderConfigSection } from './sections/provider-config-section'
import { TaskModelSection } from './sections/task-model-section'
import { NotificationChannelsSection } from './sections/notification-channels-section'

export function IntegrationTab() {
  const { settings } = useAppLayout()
  const { t } = useI18n()

  return (
    <>
      <ProviderConfigSection t={t} settings={settings} />
      <Separator />
      <NotificationChannelsSection t={t} />
      <Separator />
      <TaskModelSection settings={settings} t={t} />
    </>
  )
}
