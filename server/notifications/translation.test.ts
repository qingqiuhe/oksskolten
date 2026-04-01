import { describe, expect, it } from 'vitest'
import { needsSimplifiedChineseTranslation } from './translation.js'

describe('needsSimplifiedChineseTranslation', () => {
  it('returns false for empty text', () => {
    expect(needsSimplifiedChineseTranslation('')).toBe(false)
    expect(needsSimplifiedChineseTranslation('   ')).toBe(false)
  })

  it('returns true for latin text', () => {
    expect(needsSimplifiedChineseTranslation('Breaking news from example.com')).toBe(true)
  })

  it('returns false for simplified chinese text', () => {
    expect(needsSimplifiedChineseTranslation('这是一个简体中文正文预览')).toBe(false)
  })

  it('returns true for traditional chinese text', () => {
    expect(needsSimplifiedChineseTranslation('這是一個繁體中文正文預覽')).toBe(true)
  })

  it('returns true for japanese text with kana', () => {
    expect(needsSimplifiedChineseTranslation('これは日本語の本文です')).toBe(true)
  })
})
