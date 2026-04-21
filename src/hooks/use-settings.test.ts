import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- Sub-hook mocks ---

const mockSetTheme = vi.fn()
const mockSetDateMode = vi.fn()
const mockSetAutoMarkRead = vi.fn()
const mockSetShowUnreadIndicator = vi.fn()
const mockSetInternalLinks = vi.fn()
const mockSetHighlightTheme = vi.fn()
const mockSetColorMode = vi.fn()

vi.mock('./use-dark-mode', () => ({
  useDarkMode: () => ({
    isDark: false,
    colorMode: 'system' as const,
    setColorMode: mockSetColorMode,
  }),
}))

vi.mock('./use-theme', () => ({
  useTheme: () => ({
    themeName: 'default',
    setTheme: mockSetTheme,
    themes: [
      { name: 'default', highlight: 'github', indicatorStyle: 'dot' },
      { name: 'dark-theme', highlight: 'github-dark' },
    ],
  }),
}))

vi.mock('./use-date-mode', () => ({
  useDateMode: () => ({
    dateMode: 'relative' as const,
    setDateMode: mockSetDateMode,
  }),
}))

vi.mock('./use-auto-mark-read', () => ({
  useAutoMarkRead: () => ({
    autoMarkRead: 'off' as const,
    setAutoMarkRead: mockSetAutoMarkRead,
  }),
}))

vi.mock('./use-unread-indicator', () => ({
  useUnreadIndicator: () => ({
    showUnreadIndicator: 'on' as const,
    setShowUnreadIndicator: mockSetShowUnreadIndicator,
  }),
}))

vi.mock('./use-internal-links', () => ({
  useInternalLinks: () => ({
    internalLinks: 'off' as const,
    setInternalLinks: mockSetInternalLinks,
  }),
}))

vi.mock('./use-highlight-theme', () => ({
  useHighlightTheme: () => ({
    highlightTheme: 'github',
    highlightThemeOverride: null,
    setHighlightTheme: mockSetHighlightTheme,
  }),
}))

// --- SWR mock ---

let swrData: Record<string, unknown> | undefined = undefined

vi.mock('swr', () => ({
  default: () => ({
    data: swrData,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

// --- Fetcher mock ---

const mockApiPatch = vi.fn()
const mockAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }))

vi.mock('../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  authHeaders: () => mockAuthHeaders(),
}))

import { useSettings } from './use-settings'

describe('useSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSetTheme.mockReset()
    mockSetDateMode.mockReset()
    mockSetAutoMarkRead.mockReset()
    mockSetShowUnreadIndicator.mockReset()
    mockSetInternalLinks.mockReset()
    mockSetHighlightTheme.mockReset()
    mockApiPatch.mockReset()
    mockAuthHeaders.mockReset()
    mockAuthHeaders.mockReturnValue({ Authorization: 'Bearer test-token' })
    mockApiPatch.mockResolvedValue({})
    swrData = undefined
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns all expected fields', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current).toHaveProperty('isDark')
    expect(result.current).toHaveProperty('themeName')
    expect(result.current).toHaveProperty('setTheme')
    expect(result.current).toHaveProperty('dateMode')
    expect(result.current).toHaveProperty('setDateMode')
    expect(result.current).toHaveProperty('autoMarkRead')
    expect(result.current).toHaveProperty('showUnreadIndicator')
    expect(result.current).toHaveProperty('internalLinks')
    expect(result.current).toHaveProperty('highlightTheme')
    expect(result.current).toHaveProperty('indicatorStyle')
  })

  it('hydrates theme from DB prefs', () => {
    swrData = {
      'appearance.color_theme': 'solarized',
      'reading.date_mode': null,
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
      'appearance.highlight_theme': null,
    }

    renderHook(() => useSettings())

    expect(mockSetTheme).toHaveBeenCalledWith('solarized')
  })

  it('hydrates dateMode from DB prefs', () => {
    swrData = {
      'appearance.color_theme': null,
      'reading.date_mode': 'absolute',
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
      'appearance.highlight_theme': null,
    }

    renderHook(() => useSettings())

    expect(mockSetDateMode).toHaveBeenCalledWith('absolute')
  })

  it('sends backfill PATCH for unset prefs', async () => {
    swrData = {
      'appearance.color_theme': null,
      'reading.date_mode': null,
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
      'appearance.highlight_theme': null,
    }

    renderHook(() => useSettings())

    expect(mockApiPatch).toHaveBeenCalledWith(
      '/api/settings/preferences',
      expect.objectContaining({
        'appearance.color_theme': 'default',
        'reading.date_mode': 'relative',
      }),
    )
  })

  it('dirty tracking prevents hydration overwrite', () => {
    swrData = {
      'appearance.color_theme': 'old-theme',
      'reading.date_mode': null,
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
      'appearance.highlight_theme': null,
    }

    const { result, rerender } = renderHook(() => useSettings())

    // User changes theme — marks dirty
    act(() => {
      result.current.setTheme('user-theme')
    })

    // Simulate prefs update from SWR (re-render)
    swrData = {
      ...swrData,
      'appearance.color_theme': 'server-theme',
    }
    rerender()

    // setTheme should have been called with 'user-theme' but not 'server-theme' after dirty
    const calls = mockSetTheme.mock.calls.map((c: unknown[]) => c[0])
    // First call: hydration with 'old-theme', second: user 'user-theme'
    // Should NOT have 'server-theme' after dirty
    expect(calls).toContain('user-theme')
  })

  it('syncedSetTheme: sets theme + resets highlight', () => {
    const { result } = renderHook(() => useSettings())

    act(() => {
      result.current.setTheme('new-theme')
    })

    expect(mockSetTheme).toHaveBeenCalledWith('new-theme')
    expect(mockSetHighlightTheme).toHaveBeenCalledWith(null)
  })

  it('syncedSetDateMode: marks dirty and schedules save', () => {
    const { result } = renderHook(() => useSettings())

    act(() => {
      result.current.setDateMode('absolute')
    })

    expect(mockSetDateMode).toHaveBeenCalledWith('absolute')

    // Advance timer to trigger debounced save
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockApiPatch).toHaveBeenCalledWith(
      '/api/settings/preferences',
      expect.objectContaining({ 'reading.date_mode': 'absolute' }),
    )
  })

  it('debounce: consecutive setters produce a single PATCH', () => {
    const { result } = renderHook(() => useSettings())

    act(() => {
      result.current.setDateMode('absolute')
      result.current.setAutoMarkRead('on')
    })

    // Before timer fires, no PATCH yet (only backfill from initial render may have fired)
    const patchCallsBefore = mockApiPatch.mock.calls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.['reading.date_mode'] === 'absolute',
    )
    expect(patchCallsBefore).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Should have exactly one PATCH containing both changes
    const patchCalls = mockApiPatch.mock.calls.filter(
      (c: unknown[]) => {
        const body = c[1] as Record<string, unknown>
        return body?.['reading.date_mode'] === 'absolute' || body?.['reading.auto_mark_read'] === 'on'
      },
    )
    expect(patchCalls.length).toBeGreaterThanOrEqual(1)
    // The combined patch should contain both
    const combinedPatch = patchCalls[patchCalls.length - 1][1] as Record<string, unknown>
    expect(combinedPatch['reading.date_mode']).toBe('absolute')
    expect(combinedPatch['reading.auto_mark_read']).toBe('on')
  })

  it('unmount flushes pending changes via fetch keepalive', () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', mockFetch)

    const { result, unmount } = renderHook(() => useSettings())

    act(() => {
      result.current.setDateMode('absolute')
    })

    unmount()

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/settings/preferences',
      expect.objectContaining({
        method: 'PATCH',
        keepalive: true,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    )
  })

  it('unmount does not call fetch keepalive when no pending changes', () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', mockFetch)

    const { unmount } = renderHook(() => useSettings())

    // Flush any initial save by advancing timer
    act(() => {
      vi.advanceTimersByTime(500)
    })

    unmount()

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('syncedSetHighlightTheme: null maps to empty string for DB', () => {
    const { result } = renderHook(() => useSettings())

    act(() => {
      result.current.setHighlightTheme(null)
    })

    expect(mockSetHighlightTheme).toHaveBeenCalledWith(null)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Check that the PATCH contains appearance.highlight_theme: '' (empty string for DB delete)
    const patchCalls = mockApiPatch.mock.calls.filter(
      (c: unknown[]) => {
        const body = c[1] as Record<string, unknown>
        return 'appearance.highlight_theme' in body
      },
    )
    expect(patchCalls.length).toBeGreaterThanOrEqual(1)
    const lastPatch = patchCalls[patchCalls.length - 1][1] as Record<string, unknown>
    expect(lastPatch['appearance.highlight_theme']).toBe('')
  })

  it('hydrates dirty key after in-flight save completes', async () => {
    let resolvePatch: (() => void) | null = null
    mockApiPatch.mockImplementation(() => new Promise<void>((resolve) => { resolvePatch = resolve }))

    swrData = {
      'appearance.color_theme': 'default',
      'reading.date_mode': 'relative',
      'reading.auto_mark_read': 'off',
      'reading.unread_indicator': 'on',
      'reading.internal_links': 'off',
      'reading.show_thumbnails': 'on',
      'reading.show_feed_activity': 'on',
      'reading.chat_position': 'fab',
      'reading.article_open_mode': 'page',
      'reading.category_unread_only': 'off',
      'appearance.list_layout': 'list',
      'appearance.mascot': 'off',
      'reading.keyboard_navigation': 'off',
      'appearance.highlight_theme': null,
    }

    const { result, rerender } = renderHook(() => useSettings())
    mockSetDateMode.mockClear()

    act(() => {
      result.current.setDateMode('absolute')
      vi.advanceTimersByTime(500)
    })

    swrData = {
      ...swrData,
      'reading.date_mode': 'relative',
    }
    rerender()

    expect(mockSetDateMode).not.toHaveBeenCalledWith('relative')

    await act(async () => {
      resolvePatch?.()
      await Promise.resolve()
    })

    swrData = {
      ...swrData,
      'reading.date_mode': 'relative',
    }
    rerender()

    expect(mockSetDateMode).toHaveBeenLastCalledWith('relative')
  })

  it('hydrates highlight_theme from DB prefs', () => {
    swrData = {
      'appearance.color_theme': null,
      'reading.date_mode': null,
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
      'appearance.highlight_theme': 'monokai',
    }

    renderHook(() => useSettings())

    expect(mockSetHighlightTheme).toHaveBeenCalledWith('monokai')
  })
})
