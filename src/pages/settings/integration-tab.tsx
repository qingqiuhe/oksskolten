import useSWR from 'swr'
import { useI18n } from '../../lib/i18n'
import { useAppLayout } from '../../app'
import { Separator } from '@/components/ui/separator'
import { ProviderConfigSection } from './sections/provider-config-section'
import { TaskModelSection } from './sections/task-model-section'
import type { CustomLLMProvider, Prefs, ProviderKeyStatus } from './sections/task-model-section'
import { fetcher } from '../../lib/fetcher'

const SWR_KEY_OPTS = { revalidateOnFocus: false } as const

export function IntegrationTab() {
  const { settings } = useAppLayout()
  const { t } = useI18n()
  const { data: keyStatus, mutate: mutateKeyStatus } = useSWR<{ keys: ProviderKeyStatus }>('/api/settings/api-keys', fetcher, SWR_KEY_OPTS)
  const { data: claudeCodeStatus } = useSWR<{ loggedIn?: boolean; email?: string; plan?: string; error?: string }>(
    '/api/chat/claude-code-status',
    fetcher,
    SWR_KEY_OPTS,
  )
  const { data: prefs, mutate: mutatePrefs } = useSWR<Prefs>('/api/settings/preferences', fetcher, SWR_KEY_OPTS)
  const { data: customProvidersData, mutate: mutateCustomProviders } = useSWR<{ providers: CustomLLMProvider[] }>(
    '/api/settings/custom-llm-providers',
    fetcher,
    SWR_KEY_OPTS,
  )
  const sharedData = {
    keyStatus,
    mutateKeyStatus,
    claudeCodeStatus,
    prefs,
    mutatePrefs,
    customProvidersData,
    mutateCustomProviders,
  }

  return (
    <>
      <ProviderConfigSection t={t} settings={settings} sharedData={sharedData} />
      <Separator />
      <TaskModelSection settings={settings} t={t} sharedData={sharedData} />
    </>
  )
}
