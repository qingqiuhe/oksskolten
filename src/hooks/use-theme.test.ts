import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from './use-theme'
import { themes } from '../data/themes'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset inline styles on documentElement
    document.documentElement.style.cssText = ''
    // Clear any theme-color meta tags then add one for testing
    document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove())
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', '')
    document.head.appendChild(meta)
  })

  it('defaults to "default" theme', () => {
    const { result } = renderHook(() => useTheme(false))
    expect(result.current.themeName).toBe('default')
  })

  it('restores theme from localStorage', () => {
    localStorage.setItem('color-theme', 'solarized')
    const { result } = renderHook(() => useTheme(false))
    expect(result.current.themeName).toBe('solarized')
  })

  it('setTheme updates theme name and persists to localStorage', () => {
    const { result } = renderHook(() => useTheme(false))
    act(() => result.current.setTheme('tokyo-night'))
    expect(result.current.themeName).toBe('tokyo-night')
    expect(localStorage.getItem('color-theme')).toBe('tokyo-night')
  })

  it('returns themes array', () => {
    const { result } = renderHook(() => useTheme(false))
    expect(result.current.themes).toStrictEqual(themes)
  })

  it('applies CSS custom properties to document root', () => {
    renderHook(() => useTheme(false))
    const root = document.documentElement
    const defaultTheme = themes.find(t => t.name === 'default')!
    expect(root.style.getPropertyValue('--color-bg')).toBe(defaultTheme.colors.light['--color-bg'])
  })

  it('switches to dark colors when isDark is true', () => {
    const { rerender } = renderHook(({ isDark }) => useTheme(isDark), {
      initialProps: { isDark: false },
    })
    const defaultTheme = themes.find(t => t.name === 'default')!
    const root = document.documentElement

    expect(root.style.getPropertyValue('--color-bg')).toBe(defaultTheme.colors.light['--color-bg'])

    rerender({ isDark: true })
    expect(root.style.getPropertyValue('--color-bg')).toBe(defaultTheme.colors.dark['--color-bg'])
  })

  it('updates meta theme-color tag', () => {
    renderHook(() => useTheme(false))
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const defaultTheme = themes.find(t => t.name === 'default')!
    expect(meta?.content).toBe(defaultTheme.colors.light['--color-bg'])
  })

  it('notifies embedding parent when framed', () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage },
    })
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://oksskolten.com/demo',
    })

    const { result } = renderHook(() => useTheme(false))
    act(() => result.current.setTheme('tokyo-night'))
    const theme = themes.find(t => t.name === 'tokyo-night')!

    const extractPalette = (colors: Record<string, string>) => ({
      bg: colors['--color-bg'],
      sidebar: colors['--color-bg-sidebar'] ?? colors['--color-bg'],
      header: colors['--color-bg-header'] ?? colors['--color-bg'],
      input: colors['--color-bg-input'] ?? colors['--color-bg'],
      subtle: colors['--color-bg-subtle'],
      text: colors['--color-text'],
      muted: colors['--color-muted'],
      accent: colors['--color-accent'],
      accentText: colors['--color-accent-text'],
      border: colors['--color-border'],
      hover: colors['--color-hover'],
    })

    // resolveColors fills in defaults, so use the resolved light colors for the active palette
    const resolvedLight = { '--color-bg-card': theme.colors.light['--color-bg'], '--color-bg-sidebar': theme.colors.light['--color-bg'], '--color-bg-header': theme.colors.light['--color-bg'], '--color-bg-input': theme.colors.light['--color-bg'], '--color-code': theme.colors.light['--color-text'], ...theme.colors.light }
    const resolvedDark = { '--color-bg-card': theme.colors.dark['--color-bg'], '--color-bg-sidebar': theme.colors.dark['--color-bg'], '--color-bg-header': theme.colors.dark['--color-bg'], '--color-bg-input': theme.colors.dark['--color-bg'], '--color-code': theme.colors.dark['--color-text'], ...theme.colors.dark }

    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: 'theme-changed',
        theme: 'tokyo-night',
        isDark: false,
        colors: extractPalette(resolvedLight),
        light: extractPalette(resolvedLight),
        dark: extractPalette(resolvedDark),
      },
      'https://oksskolten.com',
    )
  })

  it('does not notify parent when not framed', () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: window,
    })
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://oksskolten.com/demo',
    })

    renderHook(() => useTheme(false))

    expect(postMessage).not.toHaveBeenCalled()
  })
})
