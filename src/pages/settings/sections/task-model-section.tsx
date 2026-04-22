import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { fetcher, apiPatch } from '../../../lib/fetcher'
import {
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
  OPENAI_MODELS,
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  TRANSLATE_SERVICE_PROVIDERS,
} from '../../../data/aiModels'
import type { ModelGroup } from '../../../data/aiModels'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '@/components/ui/select'
import type { Settings } from '../../../hooks/use-settings'
import type { TranslateFn } from '../../../lib/i18n'

type TFunc = TranslateFn
type TaskKey = 'chat' | 'summary' | 'translate'

type Prefs = Record<string, string | null>
type CustomLLMProvider = {
  id: number
  name: string
  kind: 'openai-compatible'
  base_url: string
  has_api_key: boolean
}

type TaskDraft = {
  target: string
  model: string
}

type TaskDraftState = Record<TaskKey, TaskDraft>

type ProviderOption = {
  value: string
  label: string
  provider: string
  providerInstanceId: string | null
  group: 'builtIn' | 'custom' | 'translate'
  enabled: boolean
}

const SWR_KEY_OPTS = { revalidateOnFocus: false } as const
const TASK_DEFAULT_PROVIDER: Record<TaskKey, string> = {
  chat: 'anthropic',
  summary: 'anthropic',
  translate: 'anthropic',
}
const TASK_DEFAULT_MODEL: Record<TaskKey, string> = {
  chat: DEFAULT_MODELS.anthropic,
  summary: DEFAULT_MODELS.anthropic,
  translate: 'claude-sonnet-4-6',
}

export function TaskModelSection({ settings: _settings, t }: { settings: Settings; t: TFunc }) {
  const anthropicKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/anthropic`, fetcher, SWR_KEY_OPTS)
  const geminiKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/gemini`, fetcher, SWR_KEY_OPTS)
  const openaiKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/openai`, fetcher, SWR_KEY_OPTS)
  const googleTranslateKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/google-translate`, fetcher, SWR_KEY_OPTS)
  const deeplKey = useSWR<{ configured: boolean }>(`/api/settings/api-keys/deepl`, fetcher, SWR_KEY_OPTS)
  const { data: claudeCodeStatus } = useSWR<{ loggedIn?: boolean }>(
    '/api/chat/claude-code-status',
    fetcher,
    SWR_KEY_OPTS,
  )
  const { data: prefs, mutate: mutatePrefs } = useSWR<Prefs>(
    '/api/settings/preferences',
    fetcher,
    SWR_KEY_OPTS,
  )
  const { data: customProvidersData } = useSWR<{ providers: CustomLLMProvider[] }>(
    '/api/settings/custom-llm-providers',
    fetcher,
    SWR_KEY_OPTS,
  )

  const customProviders = useMemo(() => customProvidersData?.providers || [], [customProvidersData])
  const configuredKeys = useMemo(() => ({
    anthropic: !!anthropicKey.data?.configured,
    gemini: !!geminiKey.data?.configured,
    openai: !!openaiKey.data?.configured,
    'claude-code': !!claudeCodeStatus?.loggedIn,
    ollama: true,
    'google-translate': !!googleTranslateKey.data?.configured,
    deepl: !!deeplKey.data?.configured,
  }), [
    anthropicKey.data?.configured,
    geminiKey.data?.configured,
    openaiKey.data?.configured,
    claudeCodeStatus?.loggedIn,
    googleTranslateKey.data?.configured,
    deeplKey.data?.configured,
  ])

  const providerOptions = useMemo(() => {
    const options: ProviderOption[] = [
      { value: 'builtin:anthropic', label: t(PROVIDER_LABELS.anthropic), provider: 'anthropic', providerInstanceId: null, group: 'builtIn', enabled: configuredKeys.anthropic },
      { value: 'builtin:gemini', label: t(PROVIDER_LABELS.gemini), provider: 'gemini', providerInstanceId: null, group: 'builtIn', enabled: configuredKeys.gemini },
      { value: 'builtin:openai', label: t(PROVIDER_LABELS.openai), provider: 'openai', providerInstanceId: null, group: 'builtIn', enabled: configuredKeys.openai },
      { value: 'builtin:claude-code', label: t(PROVIDER_LABELS['claude-code']), provider: 'claude-code', providerInstanceId: null, group: 'builtIn', enabled: configuredKeys['claude-code'] },
      { value: 'builtin:ollama', label: t(PROVIDER_LABELS.ollama), provider: 'ollama', providerInstanceId: null, group: 'builtIn', enabled: configuredKeys.ollama },
      ...customProviders.map((provider) => ({
        value: `custom:${provider.id}`,
        label: provider.name,
        provider: 'openai',
        providerInstanceId: String(provider.id),
        group: 'custom' as const,
        enabled: provider.has_api_key,
      })),
      { value: 'builtin:google-translate', label: t(PROVIDER_LABELS['google-translate']), provider: 'google-translate', providerInstanceId: null, group: 'translate', enabled: configuredKeys['google-translate'] },
      { value: 'builtin:deepl', label: t(PROVIDER_LABELS.deepl), provider: 'deepl', providerInstanceId: null, group: 'translate', enabled: configuredKeys.deepl },
    ]
    return options
  }, [configuredKeys, customProviders, t])

  const optionMap = useMemo(() => Object.fromEntries(providerOptions.map(option => [option.value, option])), [providerOptions])
  const savedDrafts = useMemo(() => {
    if (!prefs) return null
    return buildSavedDrafts(prefs, customProviders)
  }, [prefs, customProviders])
  const [drafts, setDrafts] = useState<TaskDraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (!savedDrafts) return
    setDrafts(prev => {
      if (!prev) return savedDrafts
      const isDirty = JSON.stringify(prev) !== JSON.stringify(savedDrafts)
      return isDirty ? prev : savedDrafts
    })
  }, [savedDrafts])

  useEffect(() => {
    if (!showSaved) return
    const timer = setTimeout(() => setShowSaved(false), 1500)
    return () => clearTimeout(timer)
  }, [showSaved])

  if (!savedDrafts || !drafts) {
    return (
      <section>
        <h2 className="text-base font-semibold text-text mb-1">{t('integration.taskSettings')}</h2>
        <p className="text-xs text-muted">{t('integration.taskSettingsDesc')}</p>
      </section>
    )
  }

  const isDirty = JSON.stringify(drafts) !== JSON.stringify(savedDrafts)
  const draftValid = isDraftStateValid(drafts, optionMap)

  async function handleSave() {
    if (saving || !isDirty || !draftValid) return
    const nextDrafts = drafts as TaskDraftState
    setSaving(true)
    try {
      const updatedPrefs = await apiPatch('/api/settings/preferences', buildTaskPatch(nextDrafts, optionMap))
      void mutatePrefs(updatedPrefs as Prefs, false)
      setDrafts(buildSavedDrafts(updatedPrefs as Prefs, customProviders))
      setShowSaved(true)
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setDrafts(savedDrafts)
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-semibold text-text">{t('integration.taskSettings')}</h2>
        <span
          className={`text-xs text-accent transition-opacity duration-300 ${
            showSaved ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('settings.saved')}
        </span>
      </div>
      <p className="text-xs text-muted mb-4">{t('integration.taskSettingsDesc')}</p>
      <div className="space-y-3">
        {(['chat', 'summary', 'translate'] as TaskKey[]).map(taskKey => (
          <TaskModelRow
            key={taskKey}
            taskKey={taskKey}
            draft={drafts[taskKey]}
            options={providerOptions.filter(option => taskKey === 'translate' || option.group !== 'translate')}
            optionMap={optionMap}
            onChange={(nextDraft) => setDrafts(prev => prev ? { ...prev, [taskKey]: nextDraft } : prev)}
            t={t}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty || !draftValid}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
        >
          {saving ? '...' : t('settings.save')}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={!isDirty || saving}
          className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
        >
          {t('settings.cancel')}
        </button>
      </div>
    </section>
  )
}

function buildSavedDrafts(prefs: Prefs, customProviders: CustomLLMProvider[]): TaskDraftState {
  return {
    chat: buildTaskDraft('chat', prefs, customProviders),
    summary: buildTaskDraft('summary', prefs, customProviders),
    translate: buildTaskDraft('translate', prefs, customProviders),
  }
}

function buildTaskDraft(taskKey: TaskKey, prefs: Prefs, customProviders: CustomLLMProvider[]): TaskDraft {
  const providerKey = `${taskKey}.provider`
  const providerInstanceKey = `${taskKey}.provider_instance_id`
  const modelKey = `${taskKey}.model`
  const provider = prefs[providerKey] || TASK_DEFAULT_PROVIDER[taskKey]
  const providerInstanceId = prefs[providerInstanceKey]
  const model = prefs[modelKey] || TASK_DEFAULT_MODEL[taskKey]

  if (provider === 'openai' && providerInstanceId && customProviders.some(item => String(item.id) === providerInstanceId)) {
    return { target: `custom:${providerInstanceId}`, model }
  }

  return {
    target: `builtin:${provider}`,
    model: isTranslateService(provider) ? '' : model,
  }
}

function buildTaskPatch(drafts: TaskDraftState, optionMap: Record<string, ProviderOption>): Record<string, string> {
  const patch: Record<string, string> = {}

  for (const taskKey of ['chat', 'summary', 'translate'] as TaskKey[]) {
    const option = optionMap[drafts[taskKey].target]
    if (!option) continue
    patch[`${taskKey}.provider`] = option.provider
    patch[`${taskKey}.provider_instance_id`] = option.providerInstanceId || ''
    patch[`${taskKey}.model`] = isTranslateService(option.provider) ? '' : drafts[taskKey].model.trim()
  }

  return patch
}

function isDraftStateValid(drafts: TaskDraftState, optionMap: Record<string, ProviderOption>): boolean {
  for (const taskKey of ['chat', 'summary', 'translate'] as TaskKey[]) {
    const option = optionMap[drafts[taskKey].target]
    if (!option || !option.enabled) return false
    if (!isTranslateService(option.provider) && !drafts[taskKey].model.trim()) return false
  }
  return true
}

function TaskModelRow({
  taskKey,
  draft,
  options,
  optionMap,
  onChange,
  t,
}: {
  taskKey: TaskKey
  draft: TaskDraft
  options: ProviderOption[]
  optionMap: Record<string, ProviderOption>
  onChange: (nextDraft: TaskDraft) => void
  t: TFunc
}) {
  const selectedOption = optionMap[draft.target] || options[0]

  function handleProviderChange(value: string) {
    const nextOption = optionMap[value]
    if (!nextOption) return
    onChange({
      target: value,
      model: getNextModelValue(draft.model, selectedOption, nextOption),
    })
  }

  return (
    <div className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
      <span className="block text-xs font-medium text-text select-none">{t(`integration.task.${taskKey}`)}</span>

      <div className="space-y-1">
        <span className="block text-[11px] text-muted select-none">{t('integration.providerTarget')}</span>
        <Select value={draft.target} onValueChange={handleProviderChange}>
          <SelectTrigger>
            <SelectValue placeholder={t('integration.selectProviderFirst')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t('integration.builtInProviders')}</SelectLabel>
              {options.filter(option => option.group === 'builtIn').map(option => (
                <SelectItem key={option.value} value={option.value} disabled={!option.enabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>

            {options.some(option => option.group === 'custom') && (
              <SelectGroup>
                <SelectLabel>{t('integration.customLlmProviders')}</SelectLabel>
                {options.filter(option => option.group === 'custom').map(option => (
                  <SelectItem key={option.value} value={option.value} disabled={!option.enabled}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}

            {options.some(option => option.group === 'translate') && (
              <SelectGroup>
                <SelectLabel>{t('integration.translateServiceConfig')}</SelectLabel>
                {options.filter(option => option.group === 'translate').map(option => (
                  <SelectItem key={option.value} value={option.value} disabled={!option.enabled}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>

      {!isTranslateService(selectedOption?.provider || '') && (
        <ModelSelect
          provider={selectedOption?.provider || ''}
          modelValue={draft.model}
          setModel={(value) => onChange({ ...draft, model: value })}
          t={t}
        />
      )}

      {selectedOption?.provider === 'google-translate' && <GoogleTranslateNote t={t} />}
      {selectedOption?.provider === 'deepl' && <DeeplNote t={t} />}
    </div>
  )
}

function getNextModelValue(currentModel: string, currentOption: ProviderOption | undefined, nextOption: ProviderOption): string {
  if (isTranslateService(nextOption.provider)) return ''
  if (nextOption.provider === 'ollama') {
    return currentOption?.provider === 'ollama' ? currentModel : ''
  }
  if (currentOption?.provider === nextOption.provider && currentModel) return currentModel
  return DEFAULT_MODELS[nextOption.provider] || DEFAULT_MODELS.anthropic
}

function getModelGroups(provider: string): ModelGroup[] {
  if (provider === 'gemini') return GEMINI_MODELS
  if (provider === 'openai') return OPENAI_MODELS
  return ANTHROPIC_MODELS
}

function isTranslateService(provider: string): boolean {
  return (TRANSLATE_SERVICE_PROVIDERS as readonly string[]).includes(provider)
}

function ModelSelect({ provider, modelValue, setModel, t }: { provider: string; modelValue: string; setModel: (v: string) => void; t: TFunc }) {
  const { data: ollamaModels } = useSWR<{ models: Array<{ name: string; size: number; parameter_size: string }> }>(
    provider === 'ollama' ? '/api/settings/ollama/models' : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const isCustomOpenAIModel = provider === 'openai' && Boolean(modelValue) && !OPENAI_MODELS.some(
    group => group.models.some(model => model.value === modelValue),
  )

  useEffect(() => {
    if (provider === 'ollama' && ollamaModels?.models?.length && !modelValue) {
      setModel(ollamaModels.models[0].name)
    }
  }, [provider, ollamaModels, modelValue, setModel])

  if (!provider) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder={t('integration.selectProviderFirst')} />
        </SelectTrigger>
        <SelectContent />
      </Select>
    )
  }

  if (provider === 'ollama') {
    const models = ollamaModels?.models || []
    if (models.length === 0) {
      return (
        <Select disabled>
          <SelectTrigger>
            <SelectValue placeholder={t('ollama.noModels')} />
          </SelectTrigger>
          <SelectContent />
        </Select>
      )
    }
    return (
      <Select value={modelValue || undefined} onValueChange={setModel}>
        <SelectTrigger>
          <SelectValue placeholder={t('integration.selectModel')} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {models.map(m => (
              <SelectItem key={m.name} value={m.name}>
                {m.name}{m.parameter_size ? ` (${m.parameter_size})` : ''}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <span className="block text-[11px] text-muted select-none">{t('integration.modelSelection')}</span>
        <Select value={isCustomOpenAIModel ? undefined : (modelValue || undefined)} onValueChange={setModel}>
          <SelectTrigger>
            <SelectValue placeholder={t('integration.selectModel')} />
          </SelectTrigger>
          <SelectContent>
            {getModelGroups(provider).map(group => (
              <SelectGroup key={group.group}>
                <SelectLabel>{group.group}</SelectLabel>
                {group.models.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label} ({m.value})</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      {provider === 'openai' && (
        <div className="space-y-1">
          <span className="block text-[11px] text-muted select-none">{t('openai.customModelName')}</span>
          <Input
            value={modelValue}
            onChange={e => setModel(e.target.value)}
            placeholder={t('openai.customModelPlaceholder')}
            className="h-9"
          />
          <p className="text-[11px] text-muted">{t('openai.customModelDesc')}</p>
        </div>
      )}
    </div>
  )
}

function GoogleTranslateNote({ t }: { t: TFunc }) {
  const { data } = useSWR<{ monthlyChars: number; freeTierRemaining: number }>(
    '/api/settings/google-translate/usage',
    fetcher,
    { revalidateOnFocus: false },
  )
  const monthlyK = data ? (data.monthlyChars / 1000).toFixed(0) : '—'
  return (
    <div className="rounded-md bg-bg-subtle px-3 py-2 text-xs text-muted select-none">
      <p>{t('integration.googleTranslateNote')}</p>
      <p className="mt-1.5 text-[11px] text-muted/70">{t('integration.googleTranslateFreeTier')}</p>
      <p className="mt-1 text-[11px] text-muted/70">{t('integration.googleTranslateUsage', { used: `${monthlyK}K`, limit: '500K' })}</p>
    </div>
  )
}

function DeeplNote({ t }: { t: TFunc }) {
  const { data } = useSWR<{ monthlyChars: number; freeTierRemaining: number }>(
    '/api/settings/deepl/usage',
    fetcher,
    { revalidateOnFocus: false },
  )
  const monthlyK = data ? (data.monthlyChars / 1000).toFixed(0) : '—'
  return (
    <div className="rounded-md bg-bg-subtle px-3 py-2 text-xs text-muted select-none">
      <p>{t('integration.deeplNote')}</p>
      <p className="mt-1.5 text-[11px] text-muted/70">{t('integration.deeplFreeTier')}</p>
      <p className="mt-1 text-[11px] text-muted/70">{t('integration.deeplUsage', { used: `${monthlyK}K`, limit: '500K' })}</p>
    </div>
  )
}
