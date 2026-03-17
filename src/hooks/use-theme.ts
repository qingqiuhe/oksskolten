import { useState, useEffect, useCallback, useMemo } from 'react'
import { themes as builtinThemes, type Theme } from '../data/themes'

function getInitialTheme(): string {
  return localStorage.getItem('color-theme') || 'default'
}

function resolveColors(colors: Record<string, string>): Record<string, string> {
  const bg = colors['--color-bg']
  const text = colors['--color-text']
  return {
    '--color-bg-card': bg,
    '--color-bg-sidebar': bg,
    '--color-bg-header': bg,
    '--color-bg-input': bg,
    '--color-code': text,
    ...colors,
  }
}

function hexToRgbChannels(hex: string): string | null {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return null
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`
}

function syncThemeColorMeta(color: string) {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  metas.forEach(meta => { meta.content = color })
}

function extractPalette(colors: Record<string, string>) {
  return {
    bg: colors['--color-bg'],
    sidebar: colors['--color-bg-sidebar'],
    header: colors['--color-bg-header'],
    input: colors['--color-bg-input'],
    subtle: colors['--color-bg-subtle'],
    text: colors['--color-text'],
    muted: colors['--color-muted'],
    accent: colors['--color-accent'],
    accentText: colors['--color-accent-text'],
    border: colors['--color-border'],
    hover: colors['--color-hover'],
  }
}

function notifyEmbeddingParent(themeName: string, isDark: boolean, colors: Record<string, string>, theme: Theme) {
  if (window.parent === window) return

  const referrer = document.referrer
  if (!referrer) return

  let targetOrigin: string
  try {
    targetOrigin = new URL(referrer).origin
  } catch {
    return
  }

  // Send both light and dark palettes so the parent can switch on OS theme change.
  const lightColors = resolveColors(theme.colors.light)
  const darkColors = resolveColors(theme.colors.dark)

  window.parent.postMessage({
    type: 'theme-changed',
    theme: themeName,
    isDark,
    colors: extractPalette(colors),
    light: extractPalette(lightColors),
    dark: extractPalette(darkColors),
  }, targetOrigin)
}

function applyTheme(themeName: string, isDark: boolean, allThemes: Theme[]) {
  const theme = allThemes.find(t => t.name === themeName) ?? allThemes[0]
  const colors = resolveColors(isDark ? theme.colors.dark : theme.colors.light)
  const root = document.documentElement
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value)
    if (key === '--color-bg-header') {
      const rgb = hexToRgbChannels(value)
      if (rgb) root.style.setProperty('--color-bg-header-rgb', rgb)
    }
  }
  const bg = colors['--color-bg']
  if (bg) {
    localStorage.setItem('theme-bg', bg)
    syncThemeColorMeta(bg)
  }

  notifyEmbeddingParent(theme.name, isDark, colors, theme)
}

export function useTheme(isDark: boolean, customThemes: Theme[] = []) {
  const [themeName, setThemeName] = useState(getInitialTheme)

  const themes = useMemo(
    () => [...builtinThemes, ...customThemes],
    [customThemes],
  )

  useEffect(() => {
    applyTheme(themeName, isDark, themes)
  }, [themeName, isDark, themes])

  const setTheme = useCallback((name: string) => {
    setThemeName(name)
    localStorage.setItem('color-theme', name)
  }, [])

  return { themeName, setTheme, themes }
}
