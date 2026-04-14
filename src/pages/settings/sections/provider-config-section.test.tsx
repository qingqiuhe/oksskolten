import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderConfigSection } from './provider-config-section'

const mockApiPost = vi.fn()
const mockApiPatch = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
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
    'openai.baseUrlDesc': 'Set the endpoint for an OpenAI-compatible API',
    'openai.baseUrlPlaceholder': 'https://api.openai.com/v1',
    'openai.compatibleApiNote': 'Compatible APIs are supported',
    'openai.baseUrlSaved': 'Base URL saved',
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
        'openai.base_url': 'https://old.example/v1',
        'ollama.base_url': '',
        'ollama.custom_headers': '',
      },
      '/api/chat/claude-code-status': { loggedIn: false },
    }
    mockApiPost.mockResolvedValue({})
    mockApiPatch.mockResolvedValue({
      ...(swrData['/api/settings/preferences'] as Record<string, unknown>),
      'openai.base_url': 'https://new.example/v1',
      'chat.provider': 'openai',
      'chat.model': 'gpt-4.1-mini',
    })
  })

  it('switches chat to openai when saving the openai provider config', async () => {
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

    await user.type(screen.getByPlaceholderText('sk-...'), 'sk-new')
    const baseUrlInput = screen.getByDisplayValue('https://old.example/v1')
    await user.clear(baseUrlInput)
    await user.type(baseUrlInput, 'https://new.example/v1')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/settings/api-keys/openai', { apiKey: 'sk-new' })
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/preferences', {
        'openai.base_url': 'https://new.example/v1',
        'chat.provider': 'openai',
        'chat.model': 'gpt-4.1-mini',
      })
    })
  })
})
