import { describe, expect, it } from 'vitest'
import { buildRssHubTwitterUserUrl, normalizeRssHubBaseUrl, parseXAccountInput } from './social-sources.js'

describe('parseXAccountInput', () => {
  it('accepts raw handles and profile urls', () => {
    expect(parseXAccountInput('@elonmusk')).toEqual({
      handle: 'elonmusk',
      profileUrl: 'https://x.com/elonmusk',
    })
    expect(parseXAccountInput('elonmusk')).toEqual({
      handle: 'elonmusk',
      profileUrl: 'https://x.com/elonmusk',
    })
    expect(parseXAccountInput('https://x.com/elonmusk')).toEqual({
      handle: 'elonmusk',
      profileUrl: 'https://x.com/elonmusk',
    })
    expect(parseXAccountInput('https://twitter.com/elonmusk')).toEqual({
      handle: 'elonmusk',
      profileUrl: 'https://x.com/elonmusk',
    })
  })

  it('rejects non-profile urls', () => {
    expect(parseXAccountInput('https://x.com/elonmusk/status/1')).toBeNull()
    expect(parseXAccountInput('https://x.com/home')).toBeNull()
    expect(parseXAccountInput('https://x.com/search?q=test')).toBeNull()
    expect(parseXAccountInput('')).toBeNull()
  })
})

describe('normalizeRssHubBaseUrl', () => {
  it('normalizes https base urls and strips trailing slash', () => {
    expect(normalizeRssHubBaseUrl('https://rsshub-gamma-ebon.vercel.app/')).toBe('https://rsshub-gamma-ebon.vercel.app')
    expect(normalizeRssHubBaseUrl('https://example.com/base/')).toBe('https://example.com/base')
  })

  it('rejects invalid or non-https urls', () => {
    expect(normalizeRssHubBaseUrl('http://rsshub.local')).toBeNull()
    expect(normalizeRssHubBaseUrl('not-a-url')).toBeNull()
  })
})

describe('buildRssHubTwitterUserUrl', () => {
  it('joins the base url and X route', () => {
    expect(buildRssHubTwitterUserUrl('https://rsshub-gamma-ebon.vercel.app', 'elonmusk')).toBe(
      'https://rsshub-gamma-ebon.vercel.app/twitter/user/elonmusk',
    )
  })
})
