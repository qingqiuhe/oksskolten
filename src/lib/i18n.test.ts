import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { LocaleContext, useI18n, normalizeLocale, detectBrowserLocale, resolvePreferredLocale } from './i18n'

function makeWrapper(locale: 'ja' | 'en' | 'zh') {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(LocaleContext.Provider, { value: { locale, setLocale: () => {} } }, children)
}

describe('useI18n', () => {
  it('returns Japanese text when locale is ja', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('ja') })
    expect(result.current.t('feeds.inbox')).toBe('Inbox')
    expect(result.current.t('feeds.title')).toBe('フィード')
  })

  it('returns English text when locale is en', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('en') })
    expect(result.current.t('feeds.title')).toBe('Feeds')
  })

  it('returns Simplified Chinese text when locale is zh', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('zh') })
    expect(result.current.t('feeds.title')).toBe('订阅源')
    expect(result.current.t('settings.languageZh')).toBe('简体中文')
  })

  it('replaces parameters in text', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('en') })
    const text = result.current.t('feeds.deleteConfirm', { name: 'TestFeed' })
    expect(text).toContain('TestFeed')
    expect(text).not.toContain('${name}')
  })

  it('replaces parameters in Japanese text', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('ja') })
    const text = result.current.t('feeds.deleteConfirm', { name: 'テスト' })
    expect(text).toContain('テスト')
    expect(text).not.toContain('${name}')
  })

  it('exposes locale value', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('ja') })
    expect(result.current.locale).toBe('ja')
  })
})

describe('locale helpers', () => {
  it('normalizes only supported locales', () => {
    expect(normalizeLocale('zh')).toBe('zh')
    expect(normalizeLocale('zh-CN')).toBeNull()
    expect(normalizeLocale('fr')).toBeNull()
  })

  it('detects Simplified Chinese from browser locale', () => {
    expect(detectBrowserLocale('zh-CN')).toBe('zh')
    expect(detectBrowserLocale('zh-Hans')).toBe('zh')
  })

  it('prefers URL locale over cached and profile locale', () => {
    expect(resolvePreferredLocale({
      urlLocale: 'zh',
      storedLocale: 'en',
      profileLocale: 'ja',
      navigatorLanguage: 'en-US',
    })).toBe('zh')
  })

  it('uses cached locale when URL locale is absent', () => {
    expect(resolvePreferredLocale({
      storedLocale: 'zh',
      profileLocale: 'ja',
      navigatorLanguage: 'en-US',
    })).toBe('zh')
  })

  it('uses profile locale when URL and cache are absent', () => {
    expect(resolvePreferredLocale({
      profileLocale: 'zh',
      navigatorLanguage: 'en-US',
    })).toBe('zh')
  })

  it('falls back to browser locale when no explicit preference exists', () => {
    expect(resolvePreferredLocale({
      navigatorLanguage: 'zh-CN',
    })).toBe('zh')
  })
})
