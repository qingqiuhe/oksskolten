import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetSetting, mockGetSettings, mockUpsertSetting, mockFetch } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockGetSettings: vi.fn(),
  mockUpsertSetting: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  upsertSetting: (...args: unknown[]) => mockUpsertSetting(...args),
}))

vi.stubGlobal('fetch', mockFetch)

import { requireDeeplKey, deeplTranslate, getDeeplMonthlyUsage } from './deepl.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDeeplResponse(translatedText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      translations: [{ text: translatedText }],
    }),
  })
}

function setupApiKey(key = 'deepl-key:fx') {
  mockGetSetting.mockImplementation((k: string) => {
    if (k === 'api_key.deepl') return key
    return undefined
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSettings.mockReturnValue({})
})

// ---------------------------------------------------------------------------
// requireDeeplKey
// ---------------------------------------------------------------------------

describe('requireDeeplKey', () => {
  it('returns the key when set', () => {
    mockGetSetting.mockReturnValue('deepl-key-xxx')
    expect(requireDeeplKey()).toBe('deepl-key-xxx')
  })

  it('throws with code DEEPL_KEY_NOT_SET when not set', () => {
    mockGetSetting.mockReturnValue(undefined)
    try {
      requireDeeplKey()
      expect.unreachable('should have thrown')
    } catch (err: any) {
      expect(err.code).toBe('DEEPL_KEY_NOT_SET')
    }
  })
})

// ---------------------------------------------------------------------------
// deeplTranslate — v2 pipeline (marked → translate HTML → Turndown)
// ---------------------------------------------------------------------------

describe('deeplTranslate', () => {
  it('translates plain text', async () => {
    setupApiKey('deepl-key:fx')
    mockDeeplResponse('<p>こんにちは世界</p>')

    const result = await deeplTranslate('Hello world', 'ja')

    expect(result.translatedText).toBe('こんにちは世界')
    expect(result.characters).toBeGreaterThan(0)
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api-free.deepl.com/v2/translate')
    const body = JSON.parse(opts.body)
    expect(body.target_lang).toBe('JA')
    expect(body.tag_handling).toBe('xml')
    expect(body.ignore_tags).toEqual(['code', 'pre', 'img'])
  })

  it('uses Pro API URL for non-free keys', async () => {
    setupApiKey('deepl-pro-key-xxx')
    mockDeeplResponse('<p>翻訳</p>')

    await deeplTranslate('test', 'ja')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.deepl.com/v2/translate')
  })

  it('uses Free API URL for keys ending with :fx', async () => {
    setupApiKey('some-key:fx')
    mockDeeplResponse('<p>翻訳</p>')

    await deeplTranslate('test', 'ja')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api-free.deepl.com/v2/translate')
  })

  it('sends Authorization header with DeepL-Auth-Key', async () => {
    setupApiKey('my-key:fx')
    mockDeeplResponse('<p>翻訳</p>')

    await deeplTranslate('test', 'ja')

    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers['Authorization']).toBe('DeepL-Auth-Key my-key:fx')
  })

  it('preserves inline code through translation', async () => {
    setupApiKey()
    mockDeeplResponse('<p>デバッグには <code>console.log</code> を使う</p>')

    const result = await deeplTranslate('Use `console.log` to debug', 'ja')
    expect(result.translatedText).toBe('デバッグには `console.log` を使う')
  })

  it('preserves links through translation', async () => {
    setupApiKey()
    mockDeeplResponse('<p>詳細は <a href="https://example.com">ドキュメント</a> を参照</p>')

    const result = await deeplTranslate('Visit [the docs](https://example.com) for details', 'ja')
    expect(result.translatedText).toBe('詳細は [ドキュメント](https://example.com) を参照')
  })

  it('throws on API error', async () => {
    setupApiKey('key:fx')
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 456,
      text: async () => 'Quota exceeded',
    })

    await expect(deeplTranslate('test', 'ja')).rejects.toThrow('DeepL API error: 456')
  })

  it('uses provided API key without reading settings', async () => {
    mockDeeplResponse('<p>こんにちは</p>')

    await deeplTranslate('Hello', 'ja', undefined, 'provided-key:fx')

    expect(mockGetSetting).not.toHaveBeenCalledWith('api_key.deepl', undefined)
    expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('DeepL-Auth-Key provided-key:fx')
  })

  it('splits long text into chunks', async () => {
    setupApiKey('key:fx')

    const para1 = 'A'.repeat(30_000)
    const para2 = 'B'.repeat(30_000)
    const input = `${para1}\n\n${para2}`

    mockDeeplResponse('<p>翻訳1</p>')
    mockDeeplResponse('<p>翻訳2</p>')

    const result = await deeplTranslate(input, 'ja')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.translatedText).toContain('翻訳1')
    expect(result.translatedText).toContain('翻訳2')
  })
})

// ---------------------------------------------------------------------------
// getDeeplMonthlyUsage
// ---------------------------------------------------------------------------

describe('getDeeplMonthlyUsage', () => {
  it('returns zero when no usage recorded', () => {
    mockGetSettings.mockReturnValue({})
    const usage = getDeeplMonthlyUsage()
    expect(usage.monthlyChars).toBe(0)
    expect(usage.freeTierRemaining).toBe(500_000)
  })

  it('returns stored usage for current month', () => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    mockGetSettings.mockReturnValue({
      'deepl.usage_month': currentMonth,
      'deepl.usage_chars': '100000',
    })

    const usage = getDeeplMonthlyUsage()
    expect(usage.monthlyChars).toBe(100_000)
    expect(usage.freeTierRemaining).toBe(400_000)
    expect(mockGetSetting).not.toHaveBeenCalledWith('deepl.usage_month')
    expect(mockGetSetting).not.toHaveBeenCalledWith('deepl.usage_chars')
  })

  it('returns zero for a different month (usage reset)', () => {
    mockGetSettings.mockReturnValue({
      'deepl.usage_month': '2020-01',
      'deepl.usage_chars': '999999',
    })

    const usage = getDeeplMonthlyUsage()
    expect(usage.monthlyChars).toBe(0)
    expect(usage.freeTierRemaining).toBe(500_000)
  })

  it('clamps freeTierRemaining to zero when exceeded', () => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    mockGetSettings.mockReturnValue({
      'deepl.usage_month': currentMonth,
      'deepl.usage_chars': '600000',
    })

    const usage = getDeeplMonthlyUsage()
    expect(usage.monthlyChars).toBe(600_000)
    expect(usage.freeTierRemaining).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Monthly usage tracking (via deeplTranslate calls)
// ---------------------------------------------------------------------------

describe('monthly usage tracking', () => {
  it('accumulates usage within the same month', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'api_key.deepl') return 'key:fx'
      return undefined
    })
    mockGetSettings.mockReturnValue({
      'deepl.usage_month': currentMonth,
      'deepl.usage_chars': '1000',
    })
    mockDeeplResponse('<p>翻訳済み</p>')

    const result = await deeplTranslate('Hello', 'ja')

    expect(result.monthlyChars).toBeGreaterThan(1000)
    expect(mockUpsertSetting).toHaveBeenCalledWith('deepl.usage_chars', expect.any(String), undefined)
    expect(mockGetSettings).toHaveBeenCalledWith(['deepl.usage_month', 'deepl.usage_chars'], undefined)
  })

  it('resets usage when month changes', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'api_key.deepl') return 'key:fx'
      return undefined
    })
    mockGetSettings.mockReturnValue({
      'deepl.usage_month': '2020-01',
      'deepl.usage_chars': '999999',
    })
    mockDeeplResponse('<p>翻訳済み</p>')

    const result = await deeplTranslate('Hi', 'ja')

    expect(result.monthlyChars).toBeLessThan(100)
    expect(mockUpsertSetting).toHaveBeenCalledWith('deepl.usage_month', expect.stringMatching(/^\d{4}-\d{2}$/), undefined)
  })
})
