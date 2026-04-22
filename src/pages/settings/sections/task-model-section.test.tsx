import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskModelSection } from './task-model-section'

const mockApiPatch = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
}))

let swrData: Record<string, unknown> = {}

vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key ? swrData[key] : undefined,
    mutate: vi.fn(async (value?: unknown) => value ?? (key ? swrData[key] : undefined)),
  }),
}))

function t(key: string, params?: Record<string, string>) {
  const translations: Record<string, string> = {
    'integration.taskSettings': 'Provider per Feature',
    'integration.taskSettingsDesc': 'Choose which provider and model to use',
    'integration.task.chat': 'Chat',
    'integration.task.summary': 'Summary',
    'integration.task.translate': 'Translation',
    'integration.providerTarget': 'Provider target',
    'integration.builtInProviders': 'Built-in providers',
    'integration.customLlmProviders': 'Custom LLM Providers',
    'integration.translateServiceConfig': 'Translation Services',
    'integration.selectProviderFirst': 'Select a provider first',
    'integration.selectModel': 'Select a model',
    'integration.modelSelection': 'Model',
    'settings.save': 'Save',
    'settings.saved': 'Saved',
    'settings.cancel': 'Cancel',
    'provider.anthropic': 'Anthropic API',
    'provider.gemini': 'Gemini API',
    'provider.openai': 'OpenAI API',
    'provider.claudeCode': 'Claude Code',
    'provider.ollama': 'Ollama',
    'provider.googleTranslate': 'Google Translate',
    'provider.deepl': 'DeepL',
    'openai.customModelName': 'Custom model name',
    'openai.customModelPlaceholder': 'Custom model',
    'openai.customModelDesc': 'Enter any OpenAI-compatible model id',
    'integration.googleTranslateNote': 'Google note',
    'integration.googleTranslateFreeTier': 'Google free tier',
    'integration.googleTranslateUsage': 'Google usage ${used}/${limit}',
    'integration.deeplNote': 'DeepL note',
    'integration.deeplFreeTier': 'DeepL free tier',
    'integration.deeplUsage': 'DeepL usage ${used}/${limit}',
  }
  const template = translations[key] || key
  return template.replace(/\$\{(\w+)\}/g, (_, name) => params?.[name] ?? '')
}

describe('TaskModelSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swrData = {
      '/api/settings/api-keys/anthropic': { configured: true },
      '/api/settings/api-keys/gemini': { configured: false },
      '/api/settings/api-keys/openai': { configured: false },
      '/api/settings/api-keys/google-translate': { configured: false },
      '/api/settings/api-keys/deepl': { configured: true },
      '/api/chat/claude-code-status': { loggedIn: false },
      '/api/settings/custom-llm-providers': {
        providers: [
          {
            id: 7,
            name: 'OpenRouter',
            kind: 'openai-compatible',
            base_url: 'https://openrouter.ai/api/v1',
            has_api_key: true,
          },
        ],
      },
      '/api/settings/preferences': {
        'chat.provider': 'openai',
        'chat.provider_instance_id': '7',
        'chat.model': 'gpt-4.1-mini',
        'summary.provider': 'anthropic',
        'summary.provider_instance_id': null,
        'summary.model': 'claude-haiku-4-5-20251001',
        'translate.provider': 'deepl',
        'translate.provider_instance_id': null,
        'translate.model': '',
        'translate.target_lang': null,
      },
      '/api/settings/deepl/usage': { monthlyChars: 1000, freeTierRemaining: 499000 },
    }
    mockApiPatch.mockResolvedValue(swrData['/api/settings/preferences'])
  })

  it('keeps task edits local until Save and persists provider_instance_id on save', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })

    render(<TaskModelSection settings={{} as any} t={t as any} />)

    const customModelInput = screen.getByPlaceholderText('Custom model')
    await user.clear(customModelInput)
    await user.type(customModelInput, 'deepseek-chat')

    expect(mockApiPatch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/preferences', expect.objectContaining({
        'chat.provider': 'openai',
        'chat.provider_instance_id': '7',
        'chat.model': 'deepseek-chat',
        'summary.provider': 'anthropic',
        'summary.provider_instance_id': '',
        'summary.model': 'claude-haiku-4-5-20251001',
        'translate.provider': 'deepl',
        'translate.provider_instance_id': '',
        'translate.model': '',
      }))
    })
  })
})
