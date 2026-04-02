import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationTasksSection } from './notification-tasks-section'

const mockApiPatch = vi.fn()
const mockApiDelete = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  apiDelete: (...args: unknown[]) => mockApiDelete(...args),
}))

let swrData: Record<string, unknown> = {}
const mockMutate = vi.fn(async () => undefined)

vi.mock('swr', () => ({
  default: (key: string) => ({
    data: swrData[key],
    mutate: mockMutate,
  }),
}))

describe('NotificationTasksSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    swrData = {
      '/api/me': { id: 1, role: 'admin' },
      '/api/settings/notification-channels': {
        channels: [
          { id: 101, user_id: 1, type: 'feishu_webhook', name: 'My Channel', webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/my', secret: null, enabled: 1, created_at: '', updated_at: '' },
        ],
      },
      '/api/settings/notification-tasks?scope=self': {
        scope: 'self',
        tasks: [
          {
            id: 10,
            owner: { user_id: 1, email: 'admin@example.com', role: 'admin' },
            feed: { id: 5, name: 'My Feed' },
            enabled: 1,
            delivery_mode: 'digest',
            translate_enabled: 0,
            check_interval_minutes: 15,
            next_check_at: null,
            last_checked_at: null,
            channels: [{ id: 101, name: 'My Channel', enabled: 1 }],
            last_error: null,
          },
        ],
      },
      '/api/settings/notification-tasks?scope=all': {
        scope: 'all',
        tasks: [
          {
            id: 10,
            owner: { user_id: 1, email: 'admin@example.com', role: 'admin' },
            feed: { id: 5, name: 'My Feed' },
            enabled: 1,
            delivery_mode: 'digest',
            translate_enabled: 0,
            check_interval_minutes: 15,
            next_check_at: null,
            last_checked_at: null,
            channels: [{ id: 101, name: 'My Channel', enabled: 1 }],
            last_error: null,
          },
          {
            id: 20,
            owner: { user_id: 2, email: 'member@example.com', role: 'member' },
            feed: { id: 6, name: 'Member Feed' },
            enabled: 1,
            delivery_mode: 'immediate',
            translate_enabled: 1,
            check_interval_minutes: 30,
            next_check_at: null,
            last_checked_at: null,
            channels: [{ id: 202, name: 'Member Channel', enabled: 1 }],
            last_error: 'Webhook failed',
          },
        ],
      },
    }
  })

  it('shows admin scope filters and owner column content', () => {
    render(<NotificationTasksSection />)
    expect(screen.getByText('All users')).toBeTruthy()
    expect(screen.getByText('My tasks')).toBeTruthy()
    return waitFor(() => {
      expect(screen.getByText(/Owner: admin@example.com/)).toBeTruthy()
      expect(screen.getByText(/Owner: member@example.com/)).toBeTruthy()
    })
  })

  it('allows editing channels for own task', async () => {
    mockApiPatch.mockResolvedValue({})
    render(<NotificationTasksSection />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit task' })).toHaveLength(2))
    const editButtons = screen.getAllByRole('button', { name: 'Edit task' })
    await user.click(editButtons[0])

    expect(screen.getByText('My Channel')).toBeTruthy()
    const checkbox = screen.getAllByRole('checkbox').find(node => (node as HTMLInputElement).checked)
    expect(checkbox).toBeTruthy()

    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/notification-tasks/10', {
        enabled: true,
        delivery_mode: 'digest',
        translate_enabled: false,
        check_interval_minutes: 15,
        channel_ids: [101],
      })
    })
  })

  it('keeps channels read-only for cross-user task editing', async () => {
    render(<NotificationTasksSection />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit task' })).toHaveLength(2))
    const editButtons = screen.getAllByRole('button', { name: 'Edit task' })
    await user.click(editButtons[1])

    expect(screen.getByText('Member Channel')).toBeTruthy()
    expect(screen.getByText('Channel bindings for other users are read-only here.')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: /Member Channel/ })).toBeNull()
  })
})
