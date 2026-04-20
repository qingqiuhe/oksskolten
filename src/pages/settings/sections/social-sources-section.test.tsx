import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SocialSourcesSection } from './social-sources-section'

const mockApiPatch = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
}))

let swrData: Record<string, unknown> = {}
const mockMutate = vi.fn(async (value?: unknown) => {
  if (value !== undefined) {
    swrData['/api/settings/social-sources'] = value
  }
  return value ?? swrData['/api/settings/social-sources']
})

vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key ? swrData[key] ?? undefined : undefined,
    mutate: mockMutate,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  swrData = {
    '/api/settings/social-sources': { rsshub_base_url: 'https://rsshub-gamma-ebon.vercel.app' },
  }
})

describe('SocialSourcesSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  it('renders the current RSSHub base url from the API', () => {
    render(<SocialSourcesSection />)
    expect(screen.getByDisplayValue('https://rsshub-gamma-ebon.vercel.app')).toBeTruthy()
    expect(screen.getByText('Configure the RSSHub instance used for social media subscriptions')).toBeTruthy()
  })

  it('saves a new RSSHub base url', async () => {
    mockApiPatch.mockResolvedValue({ rsshub_base_url: 'https://rsshub.example.com' })
    render(<SocialSourcesSection />)

    const input = screen.getByDisplayValue('https://rsshub-gamma-ebon.vercel.app')
    await user.clear(input)
    await user.type(input, 'https://rsshub.example.com')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/social-sources', {
        rsshub_base_url: 'https://rsshub.example.com',
      })
      expect(screen.getByText('Saved')).toBeTruthy()
    })
  })
})
