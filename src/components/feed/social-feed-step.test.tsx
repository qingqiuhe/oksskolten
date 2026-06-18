import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleContext } from '../../lib/i18n'
import { SocialFeedStep } from './social-feed-step'

const swrKeys: Array<string | null> = []

vi.mock('swr', () => ({
  default: (key: string | null) => {
    swrKeys.push(key)
    return { data: key ? { rsshub_base_url: 'https://rsshub.example.com' } : undefined }
  },
}))

vi.mock('../../lib/fetcher', () => ({
  apiPost: vi.fn(),
  fetcher: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

function renderStep(rsshubBaseUrl?: string) {
  render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <SocialFeedStep
        onClose={vi.fn()}
        onCreated={vi.fn()}
        categories={[]}
        rsshubBaseUrl={rsshubBaseUrl}
      />
    </LocaleContext.Provider>,
  )
}

describe('SocialFeedStep', () => {
  beforeEach(() => {
    swrKeys.length = 0
  })

  it('uses shared RSSHub base URL without requesting social source settings', () => {
    renderStep('https://shared-rsshub.example.com')

    expect(swrKeys).toEqual([null])
    expect(screen.queryByText('RSSHub instance is not configured.')).toBeNull()
  })

  it('falls back to loading social source settings when no shared URL is provided', () => {
    renderStep()

    expect(swrKeys).toEqual(['/api/settings/social-sources'])
  })
})
