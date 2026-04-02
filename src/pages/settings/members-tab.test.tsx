import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MembersTab } from './members-tab'

const mockApiPost = vi.fn()
const mockApiPatch = vi.fn()
const mockMutate = vi.fn()

const swrData: Record<string, unknown> = {
  '/api/users': {
    users: [],
  },
  '/api/categories': {
    categories: [
      { id: 10, name: 'Tech', sort_order: 0 },
    ],
  },
  '/api/feeds': {
    feeds: [
      { id: 1, name: 'Feed A', url: 'https://a.example.com', type: 'rss', category_id: 10 },
      { id: 2, name: 'Feed B', url: 'https://b.example.com', type: 'rss', category_id: 10 },
      { id: 3, name: 'Loose Feed', url: 'https://c.example.com', type: 'rss', category_id: null },
      { id: 4, name: 'Clips', url: 'clip://saved', type: 'clip', category_id: null },
    ],
  },
}

vi.mock('swr', () => ({
  default: (key: string) => ({ data: swrData[key], mutate: mockMutate }),
}))

vi.mock('../../lib/fetcher', () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  fetcher: vi.fn(),
}))

describe('MembersTab', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPost.mockResolvedValue({
      invite_url: 'http://localhost/invite/token',
      import_result: {
        imported_feed_count: 3,
        imported_category_count: 1,
      },
    })
  })

  it('defaults all non-clip feeds to selected and supports group toggle', async () => {
    render(<MembersTab />)

    expect(screen.getByText('3 feeds selected across 2 folders.')).toBeTruthy()

    await user.click(screen.getByText('Choose subscriptions'))
    await waitFor(() => {
      expect(screen.getByText('Import subscriptions')).toBeTruthy()
    })

    const techHeader = screen.getByText('Tech')
    const techCheckbox = techHeader.closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(techCheckbox.checked).toBe(true)

    await user.click(techCheckbox)
    expect(screen.getByText('1 feeds selected across 1 folders.')).toBeTruthy()

    const feedACheckbox = screen.getByText('Feed A').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(feedACheckbox.checked).toBe(false)
  })

  it('submits selected feed ids and resets after success', async () => {
    render(<MembersTab />)

    await user.click(screen.getByText('Choose subscriptions'))
    await waitFor(() => {
      expect(screen.getByText('Import subscriptions')).toBeTruthy()
    })

    const looseFeedCheckbox = screen.getByText('Loose Feed').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await user.click(looseFeedCheckbox)
    await user.click(screen.getByText('Done'))

    const emailInput = screen.getByPlaceholderText('name@example.com')
    await user.type(emailInput, 'invitee@example.com')
    await user.click(screen.getByText('Invite'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/users', {
        email: 'invitee@example.com',
        role: 'member',
        import_feed_ids: [1, 2],
      })
    })

    expect(screen.getByText('Imported 3 feeds across 1 folders.')).toBeTruthy()
    expect(screen.getByText('3 feeds selected across 2 folders.')).toBeTruthy()
  })

  it('allows inviting with zero selected feeds', async () => {
    render(<MembersTab />)

    await user.click(screen.getByText('Choose subscriptions'))
    await waitFor(() => {
      expect(screen.getByText('Deselect all')).toBeTruthy()
    })
    await user.click(screen.getByText('Deselect all'))
    await user.click(screen.getByText('Done'))

    const emailInput = screen.getByPlaceholderText('name@example.com')
    await user.type(emailInput, 'none@example.com')
    await user.click(screen.getByText('Invite'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/users', {
        email: 'none@example.com',
        role: 'member',
        import_feed_ids: [],
      })
    })
  })
})
