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

    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: 'theme-changed',
        theme: 'tokyo-night',
        isDark: false,
        colors: {
          bg: theme.colors.light['--color-bg'],
          sidebar: theme.colors.light['--color-bg-sidebar'],
          header: theme.colors.light['--color-bg'],
          input: theme.colors.light['--color-bg'],
          subtle: theme.colors.light['--color-bg-subtle'],
          text: theme.colors.light['--color-text'],
          muted: theme.colors.light['--color-muted'],
          accent: theme.colors.light['--color-accent'],
          accentText: theme.colors.light['--color-accent-text'],
          border: theme.colors.light['--color-border'],
          hover: theme.colors.light['--color-hover'],
        },
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
