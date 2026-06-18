import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { IntegrationTab } from './integration-tab'

const mockSettings = {
  translateTargetLang: '',
  setTranslateTargetLang: vi.fn(),
}

vi.mock('../../app', () => ({
  useAppLayout: () => ({ settings: mockSettings }),
}))

vi.mock('../../lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

const swrKeys: Array<string | null> = []
const swrData: Record<string, unknown> = {
  '/api/settings/api-keys': {
    keys: {
      anthropic: { configured: false },
      gemini: { configured: false },
      openai: { configured: false },
      'google-translate': { configured: false },
      deepl: { configured: false },
    },
  },
  '/api/chat/claude-code-status': { loggedIn: false },
  '/api/settings/preferences': {
    'ollama.base_url': '',
    'ollama.custom_headers': '',
    'chat.provider': 'anthropic',
    'chat.provider_instance_id': null,
    'chat.model': 'claude-haiku-4-5-20251001',
    'summary.provider': 'anthropic',
    'summary.provider_instance_id': null,
    'summary.model': 'claude-haiku-4-5-20251001',
    'translate.provider': 'anthropic',
    'translate.provider_instance_id': null,
    'translate.model': 'claude-sonnet-4-6',
  },
  '/api/settings/custom-llm-providers': { providers: [] },
}

vi.mock('swr', () => ({
  default: (key: string | null) => {
    swrKeys.push(key)
    return {
      data: key ? swrData[key] : undefined,
      mutate: vi.fn(async (value?: unknown) => value ?? (key ? swrData[key] : undefined)),
    }
  },
}))

describe('IntegrationTab', () => {
  beforeEach(() => {
    swrKeys.length = 0
    vi.clearAllMocks()
  })

  it('shares integration settings requests across sections', () => {
    render(<IntegrationTab />)

    const nonNullKeys = swrKeys.filter((key): key is string => Boolean(key))
    expect(nonNullKeys.filter(key => key === '/api/settings/api-keys')).toHaveLength(1)
    expect(nonNullKeys.filter(key => key === '/api/chat/claude-code-status')).toHaveLength(1)
    expect(nonNullKeys.filter(key => key === '/api/settings/preferences')).toHaveLength(1)
    expect(nonNullKeys.filter(key => key === '/api/settings/custom-llm-providers')).toHaveLength(1)
  })
})
