import { useState } from 'react'
import useSWR from 'swr'
import { fetcher, apiPost } from '../../../lib/fetcher'
import { PROVIDER_LABELS, LLM_API_PROVIDERS, TRANSLATE_SERVICE_PROVIDERS } from '../../../data/aiModels'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { ExternalLink, CircleDot, CircleCheck, CircleSlash } from 'lucide-react'
import type { Settings } from '../../../hooks/use-settings'

type TFunc = (key: any, params?: Record<string, string>) => string

export function ProviderConfigSection({ t, settings }: { t: TFunc; settings: Settings }) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text mb-1">{t('integration.llmProviderConfig')}</h2>
        <p className="text-xs text-muted mb-4">{t('integration.llmProviderConfigDesc')}</p>
        <div className="space-y-3">
          {LLM_API_PROVIDERS.map(provider => (
            <ApiProviderCard key={provider} provider={provider} t={t} />
          ))}
          <ClaudeCodeCard t={t} />
        </div>
      </div>
      <div>
        <h2 className="text-base font-semibold text-text mb-1">{t('integration.translateServiceConfig')}</h2>
        <p className="text-xs text-muted mb-4">{t('integration.translateServiceConfigDesc')}</p>
        <div className="space-y-3">
          {TRANSLATE_SERVICE_PROVIDERS.map(provider => (
            <ApiProviderCard key={provider} provider={provider} t={t} />
          ))}
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-medium text-text mb-1">{t('settings.translateTargetLang')}</h3>
          <p className="text-xs text-muted mb-3">{t('settings.translateTargetLangDesc')}</p>
          <div className="flex rounded-md bg-bg-subtle p-0.5">
            {([
              { value: '', label: t('settings.translateTargetLangAuto') },
              { value: 'ja', label: t('settings.languageJa') },
              { value: 'en', label: t('settings.languageEn') },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => settings.setTranslateTargetLang(opt.value)}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors select-none ${
                  (settings.translateTargetLang || '') === opt.value
                    ? 'bg-accent text-accent-text font-medium shadow-sm'
                    : 'text-muted hover:text-text'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ApiProviderCard({ provider, t }: { provider: string; t: TFunc }) {
  const { data: keyStatus, mutate: mutateKeyStatus } = useSWR<{ configured: boolean }>(
    `/api/settings/api-keys/${provider}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  function showMessage(text: string, type: 'success' | 'error') {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const endpoint = `/api/settings/api-keys/${provider}`
  const savedMsg = provider === 'gemini' ? t('gemini.apiKeySaved')
    : provider === 'openai' ? t('openai.apiKeySaved')
    : provider === 'google-translate' ? t('googleTranslate.apiKeySaved')
    : provider === 'deepl' ? t('deepl.apiKeySaved')
    : t('chat.apiKeySaved')
  const deletedMsg = provider === 'gemini' ? t('gemini.apiKeyDeleted')
    : provider === 'openai' ? t('openai.apiKeyDeleted')
    : provider === 'google-translate' ? t('googleTranslate.apiKeyDeleted')
    : provider === 'deepl' ? t('deepl.apiKeyDeleted')
    : t('chat.apiKeyDeleted')
  const placeholder = provider === 'gemini' ? 'AIza...'
    : provider === 'openai' ? 'sk-...'
    : provider === 'google-translate' ? 'AIza...'
    : provider === 'deepl' ? '...'
    : 'sk-ant-...'

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await apiPost(endpoint, { apiKey: apiKeyInput })
      void mutateKeyStatus()
      setApiKeyInput('')
      showMessage(savedMsg, 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (saving) return
    setSaving(true)
    try {
      await apiPost(endpoint, { apiKey: '' })
      void mutateKeyStatus()
      setApiKeyInput('')
      showMessage(deletedMsg, 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const isConfigured = keyStatus?.configured

  return (
    <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2 min-h-[3rem]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${isConfigured ? 'bg-success' : 'bg-error'}`} />
          <span className="text-sm font-medium text-text select-none">{t(PROVIDER_LABELS[provider])}</span>
          <span className="text-xs text-muted select-none">
            {isConfigured ? t('chat.apiKeyConfigured') : t('chat.apiKeyNotSet')}
          </span>
        </div>
        {isConfigured && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="px-3 py-1 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
          >
            {t('chat.apiKeyDelete')}
          </button>
        )}
      </div>

      {!isConfigured && (
        <FormField label={t('chat.apiKey')} compact>
          <div className="flex items-center gap-2">
          <Input
            type="password"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            placeholder={placeholder}
            className="flex-1 py-1.5"
          />
          {apiKeyInput && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
            >
              {saving ? '...' : t('settings.save')}
            </button>
          )}
          </div>
        </FormField>
      )}

      {message && (
        <p className={`text-xs ${message.type === 'error' ? 'text-error' : 'text-accent'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

function ClaudeCodeCard({ t }: { t: TFunc }) {
  const { data: authStatus } = useSWR<{ loggedIn?: boolean; email?: string; plan?: string; error?: string }>(
    '/api/chat/claude-code-status',
    fetcher,
    { revalidateOnFocus: false },
  )

  let statusDot = 'bg-error'
  let statusText: React.ReactNode = '...'

  if (authStatus !== undefined) {
    if (authStatus.error?.includes('not found')) {
      statusDot = 'bg-error'
      statusText = t('chat.authNotInstalled')
    } else if (authStatus.loggedIn) {
      statusDot = 'bg-success'
      statusText = (
        <>
          {t('chat.authConnected')}
          {authStatus.email && <span className="text-muted ml-1.5">({authStatus.email})</span>}
        </>
      )
    } else {
      statusDot = 'bg-warning'
      statusText = (
        <div>
          <span>{t('chat.authNotConnected')}</span>
          <p className="text-muted mt-0.5">{t('chat.authRunLogin')}</p>
        </div>
      )
    }
  }

  return (
    <div className="p-3 rounded-lg bg-bg-card border border-border min-h-[3rem] space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
        <span className="text-sm font-medium text-text select-none">{t(PROVIDER_LABELS['claude-code'])}</span>
        <span className="text-xs text-muted select-none">{statusText}</span>
      </div>
      <div className="rounded-md bg-bg-subtle px-3 py-2 text-xs text-muted select-none">
        <p>{t('chat.authNote')}</p>
        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted/70">
          <div className="flex gap-1">
            <span className="w-[5.5em] shrink-0">{t('chat.authHowToLoginLabel')}</span>
            <code>claude auth login</code>
          </div>
          <div className="flex gap-1">
            <span className="w-[5.5em] shrink-0">{t('chat.authHowToLogoutLabel')}</span>
            <code>claude auth logout</code>
          </div>
        </div>
        <details className="mt-1.5">
          <summary className="text-[11px] text-muted/70 cursor-pointer select-none hover:text-muted">
            {t('chat.authNoteIssue')}
          </summary>
          <div className="mt-1 ml-3 space-y-0.5 text-[11px] text-muted/70">
            {([
              { id: 228, title: 'OAuth 2.0 Device Authorization Grant', status: 'not_planned' },
              { id: 7100, title: 'Headless/Remote Authentication', status: 'not_planned' },
              { id: 22992, title: 'Device Code Flow (RFC 8628)', status: 'open' },
              { id: 33269, title: 'OAuth login fails due to Cloudflare race condition', status: 'open' },
              { id: 34575, title: 'MCP connector sync + setup-token', status: 'open' },
            ] as { id: number; title: string; status: 'open' | 'completed' | 'not_planned' }[]).map(({ id, title, status }) => (
              <a
                key={id}
                href={`https://github.com/anthropics/claude-code/issues/${id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 pl-2 hover:text-muted underline"
              >
                {status === 'open' && <CircleDot size={10} className="shrink-0 text-success" />}
                {status === 'completed' && <CircleCheck size={10} className="shrink-0 text-purple-500" />}
                {status === 'not_planned' && <CircleSlash size={10} className="shrink-0 text-muted/50" />}
                <span className="tabular-nums w-[6ch] shrink-0">#{id}</span>
                <span>{title}</span>
                <ExternalLink size={10} className="shrink-0" />
              </a>
            ))}
          </div>
        </details>
      </div>
    </div>
  )
}
