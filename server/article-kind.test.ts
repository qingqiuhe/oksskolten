import { describe, expect, it } from 'vitest'
import { extractXHandle, resolveFeedViewType } from '../shared/article-kind.js'

describe('resolveFeedViewType', () => {
  it('prefers explicit overrides', () => {
    expect(resolveFeedViewType({ view_type: 'article', url: 'https://x.com/example' })).toBe('article')
    expect(resolveFeedViewType({ view_type: 'social', url: 'https://example.com' })).toBe('social')
  })

  it('auto-detects X feeds as social', () => {
    expect(resolveFeedViewType({
      view_type: null,
      url: 'https://x.com/example',
      rss_url: 'https://rsshub.app/twitter/user/example',
    })).toBe('social')
  })

  it('defaults non-X feeds to article', () => {
    expect(resolveFeedViewType({ view_type: null, url: 'https://example.com/blog' })).toBe('article')
  })
})

describe('extractXHandle', () => {
  it('extracts the author handle from X status URLs', () => {
    expect(extractXHandle('https://x.com/example/status/123')).toBe('@example')
    expect(extractXHandle('https://twitter.com/openai/status/456')).toBe('@openai')
  })

  it('returns null for non-status URLs', () => {
    expect(extractXHandle('https://x.com/home')).toBeNull()
    expect(extractXHandle('https://example.com/post/1')).toBeNull()
  })
})
