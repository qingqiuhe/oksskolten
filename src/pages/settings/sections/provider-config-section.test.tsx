import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderConfigSection } from './provider-config-section'

const mockApiPost = vi.fn()
const mockApiPatch = vi.fn()
const mockApiDelete = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  apiDelete: (...args: unknown[]) => mockApiDelete(...args),
}))

let swrData: Record<string, unknown> = {}

vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key ? swrData[key] : undefined,
    mutate: vi.fn(async (value?: unknown) => value ?? (key ? swrData[key] : undefined)),
  }),
}))

function t(key: string) {
  const translations: Record<string, string> = {
    'integration.llmProviderConfig': 'LLM Provider Config',
    'integration.llmProviderConfigDesc': 'Configure LLM providers',
    'integration.customLlmProviders': 'Custom LLM Providers',
    'integration.customLlmProvidersDesc': 'Add explicit OpenAI-compatible providers',
    'integration.customLlmProvidersEmpty': 'No custom LLM providers yet',
    'integration.addCustomLlmProvider': 'Add Custom Provider',
    'integration.customLlmProviderCreated': 'Custom provider created',
    'integration.customLlmProviderName': 'Provider name',
    'integration.customLlmProviderNamePlaceholder': 'e.g. OpenRouter',
    'integration.customLlmProviderBaseUrlDesc': 'The OpenAI-compatible API endpoint for this provider',
    'integration.customLlmProviderType': 'OpenAI-compatible',
    'integration.customLlmProviderApiKey': 'Replace API key',
    'integration.customLlmProviderApiKeyHint': 'Leave blank to keep the current API key',
    'integration.translateServiceConfig': 'Translate Service Config',
    'integration.translateServiceConfigDesc': 'Configure translation providers',
    'settings.translateTargetLang': 'Target language',
    'settings.translateTargetLangDesc': 'Choose target language',
    'settings.translateTargetLangAuto': 'Auto',
    'settings.languageJa': 'Japanese',
    'settings.languageEn': 'English',
    'settings.languageZh': 'Chinese',
    'provider.anthropic': 'Anthropic API',
    'provider.gemini': 'Gemini API',
    'provider.openai': 'OpenAI API',
    'provider.claudeCode': 'Claude Code',
    'provider.ollama': 'Ollama',
    'provider.googleTranslate': 'Google Translate',
    'provider.deepl': 'DeepL',
    'chat.apiKeyConfigured': 'Configured',
    'chat.apiKeyNotSet': 'Not set',
    'chat.apiKey': 'API Key',
    'chat.apiKeyDelete': 'Delete',
    'settings.save': 'Save',
    'settings.saved': 'Saved',
    'openai.baseUrl': 'Base URL',
    'openai.baseUrlPlaceholder': 'https://api.openai.com/v1',
    'openai.apiKeySaved': 'OpenAI API key saved',
    'gemini.apiKeySaved': 'Gemini API key saved',
    'googleTranslate.apiKeySaved': 'Google Translate API key saved',
    'deepl.apiKeySaved': 'DeepL API key saved',
    'chat.apiKeySaved': 'API key saved',
    'openai.apiKeyDeleted': 'OpenAI API key deleted',
    'googleTranslate.apiKeyDeleted': 'Google Translate API key deleted',
    'deepl.apiKeyDeleted': 'DeepL API key deleted',
    'chat.apiKeyDeleted': 'API key deleted',
    'chat.authNotConnected': 'Not connected',
    'chat.authRunLogin': 'Run login',
    'chat.authNote': 'Claude Code auth note',
    'chat.authHowToLoginLabel': 'Login',
    'chat.authHowToLogoutLabel': 'Logout',
    'chat.authNoteIssue': 'Known issues',
    'ollama.baseUrl': 'Ollama Base URL',
    'ollama.baseUrlDesc': 'Set Ollama server URL',
    'ollama.baseUrlPlaceholder': 'http://localhost:11434',
    'ollama.customHeaders': 'Custom headers',
    'ollama.customHeadersDesc': 'Headers for the Ollama server',
    'ollama.addHeader': 'Add header',
    'ollama.testing': 'Testing...',
    'ollama.testConnection': 'Test connection',
    'ollama.connected': 'Connected',
    'ollama.connectionFailed': 'Connection failed',
  }
  return translations[key] || key
}

describe('ProviderConfigSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swrData = {
      '/api/settings/api-keys/anthropic': { configured: false },
      '/api/settings/api-keys/gemini': { configured: false },
      '/api/settings/api-keys/openai': { configured: false },
      '/api/settings/api-keys/google-translate': { configured: false },
      '/api/settings/api-keys/deepl': { configured: false },
      '/api/settings/preferences': {
        'ollama.base_url': '',
        'ollama.custom_headers': '',
      },
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
      '/api/chat/claude-code-status': { loggedIn: false },
    }
    mockApiPost.mockResolvedValue({})
    mockApiPatch.mockResolvedValue({})
    mockApiDelete.mockResolvedValue({ ok: true })
  })

  it('saves the built-in OpenAI API key without patching preferences', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })

    render(
      <ProviderConfigSection
        t={t}
        settings={{
          translateTargetLang: '',
          setTranslateTargetLang: vi.fn(),
        } as any}
      />,
    )

    await user.type(screen.getAllByPlaceholderText('sk-...')[0], 'sk-new')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/settings/api-keys/openai', { apiKey: 'sk-new' })
      expect(mockApiPatch).not.toHaveBeenCalledWith('/api/settings/preferences', expect.anything())
    })
  })

  it('creates a custom OpenAI-compatible provider', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })

    render(
      <ProviderConfigSection
        t={t}
        settings={{
          translateTargetLang: '',
          setTranslateTargetLang: vi.fn(),
        } as any}
      />,
    )

    await user.type(screen.getAllByPlaceholderText('e.g. OpenRouter')[0], 'DeepSeek')
    await user.type(screen.getAllByPlaceholderText('https://api.openai.com/v1')[0], 'https://api.deepseek.com/v1')
    await user.type(screen.getAllByPlaceholderText('sk-...')[1], 'sk-deepseek')
    await user.click(screen.getByRole('button', { name: 'Add Custom Provider' }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/settings/custom-llm-providers', {
        name: 'DeepSeek',
        base_url: 'https://api.deepseek.com/v1',
        api_key: 'sk-deepseek',
      })
    })
  })

  it('updates and deletes an existing custom provider', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })

    render(
      <ProviderConfigSection
        t={t}
        settings={{
          translateTargetLang: '',
          setTranslateTargetLang: vi.fn(),
        } as any}
      />,
    )

    const nameInputs = screen.getAllByDisplayValue('OpenRouter')
    await user.clear(nameInputs[0])
    await user.type(nameInputs[0], 'OpenRouter EU')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/custom-llm-providers/7', {
        name: 'OpenRouter EU',
      })
    })

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('/api/settings/custom-llm-providers/7')
    })
  })
})
