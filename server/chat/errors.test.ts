import { describe, it, expect } from 'vitest'
import { normalizeChatError } from './errors.js'

describe('normalizeChatError', () => {
  it('identifies scope mismatch errors', () => {
    const err = normalizeChatError(new Error('Conversation scope mismatch'))
    expect(err.category).toBe('scope_mismatch')
  })

  it('identifies provider setup required errors', () => {
    expect(normalizeChatError(new Error('API_KEY_NOT_SET')).category).toBe('provider_setup_required')
    expect(normalizeChatError(new Error('Provider not configured')).category).toBe('provider_setup_required')
    expect(normalizeChatError(new Error('HTTP 401 Unauthorized')).category).toBe('provider_setup_required')
  })

  it('identifies network / interruption errors', () => {
    expect(normalizeChatError(new Error('fetch failed')).category).toBe('network_interrupted')
    expect(normalizeChatError(new Error('ECONNRESET')).category).toBe('network_interrupted')
    expect(normalizeChatError(new Error('Request abort')).category).toBe('network_interrupted')
  })

  it('identifies provider failures', () => {
    expect(normalizeChatError(new Error('upstream rate limit 429')).category).toBe('provider_failure')
    expect(normalizeChatError(new Error('context_length exceeded')).category).toBe('provider_failure')
  })

  it('defaults to unknown', () => {
    expect(normalizeChatError(new Error('Something unusual happened')).category).toBe('unknown')
  })
})
