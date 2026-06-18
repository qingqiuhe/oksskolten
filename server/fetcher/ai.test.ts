import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetSetting, mockGetSettings, mockCreateMessage, mockStreamMessage, mockRequireKey, mockResolveLLMTaskConfig, mockGoogleTranslate, mockDeeplTranslate } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockGetSettings: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockStreamMessage: vi.fn(),
  mockRequireKey: vi.fn(),
  mockResolveLLMTaskConfig: vi.fn(),
  mockGoogleTranslate: vi.fn(),
  mockDeeplTranslate: vi.fn(),
}))

vi.mock('../db.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}))

vi.mock('../providers/llm/index.js', () => ({
  getProvider: () => ({
    name: 'anthropic',
    requireKey: mockRequireKey,
    createMessage: mockCreateMessage,
    streamMessage: mockStreamMessage,
  }),
}))

vi.mock('../llm-task-config.js', () => ({
  resolveLLMTaskConfig: (...args: unknown[]) => mockResolveLLMTaskConfig(...args),
}))

vi.mock('../providers/translate/google-translate.js', () => ({
  googleTranslate: (...args: unknown[]) => mockGoogleTranslate(...args),
}))

vi.mock('../providers/translate/deepl.js', () => ({
  deeplTranslate: (...args: unknown[]) => mockDeeplTranslate(...args),
}))

import {
  detectLanguage,
  summarizeArticle,
  streamSummarizeArticle,
  translateArticle,
  streamTranslateArticle,
  createTextTranslator,
} from './ai.js'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockReturnValue(null) // use defaults
  mockGetSettings.mockImplementation((keys: readonly string[]) => Object.fromEntries(
    keys.map(key => [key, mockGetSetting(key)]),
  ))
  mockResolveLLMTaskConfig.mockImplementation((task: string) => ({
    provider: 'anthropic',
    model: task === 'translate' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
    providerInstanceId: null,
  }))
  mockRequireKey.mockReturnValue('checked-api-key')
  mockGoogleTranslate.mockResolvedValue({
    translatedText: 'Google translated text',
    characters: 23,
    monthlyChars: 1234,
  })
  mockDeeplTranslate.mockResolvedValue({
    translatedText: 'DeepL translated text',
    characters: 21,
    monthlyChars: 2345,
  })
})

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe('detectLanguage', () => {
  it('returns "ja" for Japanese text', () => {
    expect(detectLanguage('これは日本語のテキストです。テストのために書いています。')).toBe('ja')
  })

  it('returns "en" for English text', () => {
    expect(detectLanguage('This is an English text written for testing purposes.')).toBe('en')
  })

  it('returns "en" for empty string', () => {
    expect(detectLanguage('')).toBe('en')
  })

  it('uses only first 1000 chars for detection', () => {
    const ja = 'あ'.repeat(200)
    const en = 'a'.repeat(2000)
    // First 1000 chars: 200 ja + 800 en → 200/1000 = 20% > 10% → "ja"
    expect(detectLanguage(ja + en)).toBe('ja')
  })

  it('returns "en" when CJK ratio is at boundary (<=10%)', () => {
    // 10 CJK chars + 90 ASCII = 10% → not > 10% → "en"
    const text = 'あ'.repeat(10) + 'a'.repeat(90)
    expect(detectLanguage(text)).toBe('en')
  })

  it('returns "ja" when CJK ratio is just above 10%', () => {
    // 11 CJK chars + 89 ASCII = 11% → > 10% → "ja"
    const text = 'あ'.repeat(11) + 'a'.repeat(89)
    expect(detectLanguage(text)).toBe('ja')
  })

  it('detects kanji-heavy text as Japanese', () => {
    expect(detectLanguage('東京都渋谷区で開催されたイベントに参加しました')).toBe('ja')
  })

  it('detects katakana-heavy text as Japanese', () => {
    expect(detectLanguage('プログラミングのテストケースをチェックする')).toBe('ja')
  })
})

// ---------------------------------------------------------------------------
// summarizeArticle
// ---------------------------------------------------------------------------
describe('summarizeArticle', () => {
  it('returns summary with token usage', async () => {
    mockCreateMessage.mockResolvedValue({
      text: '要約テキスト',
      inputTokens: 100,
      outputTokens: 50,
    })

    const result = await summarizeArticle('Article body text')

    expect(result.summary).toBe('要約テキスト')
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)
    expect(result.billingMode).toBe('anthropic')
    expect(result.model).toBeDefined()
  })

  it('calls requireKey before making request', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')
    expect(mockRequireKey).toHaveBeenCalled()
  })

  it('passes the checked API key to the provider request', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })

    await summarizeArticle('text')

    expect(mockCreateMessage.mock.calls[0][0].apiKey).toBe('checked-api-key')
  })

  it('uses createMessage (non-streaming)', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')
    expect(mockCreateMessage).toHaveBeenCalled()
    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  it('passes article text in prompt', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('My article content here')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.messages[0].content).toContain('My article content here')
  })

  it('sets maxTokens to 2048 for summarize', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await summarizeArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(2048)
  })

  it('uses custom model from settings', async () => {
    mockResolveLLMTaskConfig.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      providerInstanceId: null,
    })
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    const result = await summarizeArticle('text')
    expect(result.model).toBe('claude-sonnet-4-6')
  })

  it('propagates provider errors', async () => {
    mockCreateMessage.mockRejectedValue(new Error('API rate limit'))
    await expect(summarizeArticle('text')).rejects.toThrow('API rate limit')
  })

  it('propagates requireKey errors', async () => {
    mockRequireKey.mockImplementation(() => {
      throw new Error('ANTHROPIC_KEY_NOT_SET')
    })
    await expect(summarizeArticle('text')).rejects.toThrow('ANTHROPIC_KEY_NOT_SET')
    mockRequireKey.mockReset()
  })
})

// ---------------------------------------------------------------------------
// streamSummarizeArticle
// ---------------------------------------------------------------------------
describe('streamSummarizeArticle', () => {
  it('uses streamMessage and passes onText callback', async () => {
    mockStreamMessage.mockResolvedValue({ text: 'streamed summary', inputTokens: 10, outputTokens: 5 })

    const deltas: string[] = []
    const result = await streamSummarizeArticle('text', (d) => deltas.push(d))

    expect(result.summary).toBe('streamed summary')
    expect(mockStreamMessage).toHaveBeenCalled()
    expect(mockCreateMessage).not.toHaveBeenCalled()
    expect(mockStreamMessage.mock.calls[0][0].apiKey).toBe('checked-api-key')

    // Verify onText was passed through
    const onText = mockStreamMessage.mock.calls[0][1]
    onText('chunk')
    expect(deltas).toEqual(['chunk'])
  })
})

// ---------------------------------------------------------------------------
// translateArticle
// ---------------------------------------------------------------------------
describe('translateArticle', () => {
  it('returns fullTextTranslated with token usage', async () => {
    mockCreateMessage.mockResolvedValue({
      text: '翻訳されたテキスト',
      inputTokens: 200,
      outputTokens: 180,
    })

    const result = await translateArticle('English article text')

    expect(result.fullTextTranslated).toBe('翻訳されたテキスト')
    expect(result.inputTokens).toBe(200)
    expect(result.outputTokens).toBe(180)
    expect(result.billingMode).toBe('anthropic')
  })

  it('passes article text in translate prompt', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await translateArticle('Content to translate')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.messages[0].content).toContain('Content to translate')
    expect(params.messages[0].content).toContain('Translate the following article into English')
  })

  it('resolves translate target language with one batched settings read', async () => {
    mockGetSetting.mockImplementation((key: string) => key === 'general.language' ? 'zh' : undefined)
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })

    await translateArticle('Content to translate')

    expect(mockGetSettings).toHaveBeenCalledWith(['translate.target_lang', 'general.language'], undefined)
    expect(mockGetSetting).toHaveBeenCalledTimes(2)
    expect(mockCreateMessage.mock.calls[0][0].messages[0].content).toContain('Chinese')
  })

  it('sets maxTokens to 16384 for translate', async () => {
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    await translateArticle('text')

    const params = mockCreateMessage.mock.calls[0][0]
    expect(params.maxTokens).toBe(16384)
  })

  it('uses translate-specific settings keys', async () => {
    mockResolveLLMTaskConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4.1',
      providerInstanceId: null,
    })
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })
    const result = await translateArticle('text')
    expect(result.model).toBe('gpt-4.1')
  })

  it('passes custom OpenAI-compatible credentials through to the provider', async () => {
    mockResolveLLMTaskConfig.mockReturnValue({
      provider: 'openai',
      model: 'deepseek-chat',
      providerInstanceId: 12,
      openaiConfig: {
        apiKey: 'sk-openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
    })
    mockCreateMessage.mockResolvedValue({ text: 'ok', inputTokens: 0, outputTokens: 0 })

    await translateArticle('text')

    expect(mockRequireKey).toHaveBeenCalledWith(undefined, {
      apiKey: 'sk-openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
    })
    expect(mockCreateMessage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-chat',
      openaiConfig: {
        apiKey: 'sk-openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
      },
    }))
  })

  it('reads Google Translate target language and API key in one batch', async () => {
    mockResolveLLMTaskConfig.mockReturnValue({
      provider: 'google-translate',
      model: 'google-translate-v2',
      providerInstanceId: null,
    })
    mockGetSettings.mockReturnValue({
      'general.language': 'zh',
      'api_key.google_translate': 'google-key',
    })

    const result = await translateArticle('Content to translate')

    expect(result.fullTextTranslated).toBe('Google translated text')
    expect(result.billingMode).toBe('google-translate')
    expect(mockGetSettings).toHaveBeenCalledWith(['translate.target_lang', 'general.language', 'api_key.google_translate'], undefined)
    expect(mockGetSetting).not.toHaveBeenCalledWith('api_key.google_translate', undefined)
    expect(mockGoogleTranslate).toHaveBeenCalledWith('Content to translate', 'zh', undefined, 'google-key')
  })

  it('reads DeepL target language and API key in one batch', async () => {
    mockResolveLLMTaskConfig.mockReturnValue({
      provider: 'deepl',
      model: 'deepl-v2',
      providerInstanceId: null,
    })
    mockGetSettings.mockReturnValue({
      'translate.target_lang': 'ja',
      'api_key.deepl': 'deepl-key:fx',
    })

    const result = await translateArticle('Content to translate')

    expect(result.fullTextTranslated).toBe('DeepL translated text')
    expect(result.billingMode).toBe('deepl')
    expect(mockGetSettings).toHaveBeenCalledWith(['translate.target_lang', 'general.language', 'api_key.deepl'], undefined)
    expect(mockGetSetting).not.toHaveBeenCalledWith('api_key.deepl', undefined)
    expect(mockDeeplTranslate).toHaveBeenCalledWith('Content to translate', 'ja', undefined, 'deepl-key:fx')
  })
})

// ---------------------------------------------------------------------------
// streamTranslateArticle
// ---------------------------------------------------------------------------
describe('streamTranslateArticle', () => {
  it('uses streamMessage and returns fullTextTranslated', async () => {
    mockStreamMessage.mockResolvedValue({ text: 'ストリーム翻訳', inputTokens: 15, outputTokens: 12 })

    const deltas: string[] = []
    const result = await streamTranslateArticle('text', (d) => deltas.push(d))

    expect(result.fullTextTranslated).toBe('ストリーム翻訳')
    expect(mockStreamMessage).toHaveBeenCalled()
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// createTextTranslator
// ---------------------------------------------------------------------------
describe('createTextTranslator', () => {
  it('reuses resolved Google Translate API key across multiple texts', async () => {
    mockResolveLLMTaskConfig.mockReturnValue({
      provider: 'google-translate',
      model: 'google-translate-v2',
      providerInstanceId: null,
    })
    mockGetSettings.mockReturnValue({
      'api_key.google_translate': 'google-key',
    })

    const translate = createTextTranslator('zh', 7)
    const first = await translate('First title')
    const second = await translate('Second title')

    expect(first.fullTextTranslated).toBe('Google translated text')
    expect(second.fullTextTranslated).toBe('Google translated text')
    expect(mockResolveLLMTaskConfig).toHaveBeenCalledTimes(1)
    expect(mockGetSettings).toHaveBeenCalledTimes(1)
    expect(mockGetSettings).toHaveBeenCalledWith(['api_key.google_translate'], 7)
    expect(mockGetSetting).not.toHaveBeenCalledWith('api_key.google_translate', 7)
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(2)
    expect(mockGoogleTranslate).toHaveBeenNthCalledWith(1, 'First title', 'zh', 7, 'google-key')
    expect(mockGoogleTranslate).toHaveBeenNthCalledWith(2, 'Second title', 'zh', 7, 'google-key')
  })

  it('reuses resolved LLM provider key across multiple texts', async () => {
    mockCreateMessage
      .mockResolvedValueOnce({ text: 'First translated', inputTokens: 1, outputTokens: 1 })
      .mockResolvedValueOnce({ text: 'Second translated', inputTokens: 1, outputTokens: 1 })

    const translate = createTextTranslator('ja', 9)
    const first = await translate('First title')
    const second = await translate('Second title')

    expect(first.fullTextTranslated).toBe('First translated')
    expect(second.fullTextTranslated).toBe('Second translated')
    expect(mockResolveLLMTaskConfig).toHaveBeenCalledTimes(1)
    expect(mockRequireKey).toHaveBeenCalledTimes(1)
    expect(mockCreateMessage).toHaveBeenCalledTimes(2)
    expect(mockCreateMessage.mock.calls[0][0]).toEqual(expect.objectContaining({ userId: 9, apiKey: 'checked-api-key' }))
    expect(mockCreateMessage.mock.calls[1][0]).toEqual(expect.objectContaining({ userId: 9, apiKey: 'checked-api-key' }))
  })
})
