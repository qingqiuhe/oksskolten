import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationChannelsSection } from './notification-channels-section'

const mockApiPost = vi.fn()
const mockApiPatch = vi.fn()
const mockApiDelete = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
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

describe('NotificationChannelsSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  const t = (key: string) => ({
    'notifications.channelsTitle': 'Notification Channels',
    'notifications.channelsDesc': 'desc',
    'notifications.channelCreate': 'Add channel',
    'notifications.channelTypeFeishu': 'Feishu Webhook',
    'notifications.channelEdit': 'Edit channel',
    'notifications.channelAdd': 'New channel',
    'notifications.channelSaved': 'Notification channel saved',
    'notifications.channelDeleted': 'Notification channel deleted',
    'notifications.channelTestSuccess': 'Test message sent',
    'notifications.disable': 'Disable',
    'notifications.enable': 'Enable',
    'notifications.channelName': 'Channel name',
    'notifications.webhookUrl': 'Webhook URL',
    'notifications.webhookUrlHint': 'Webhook hint',
    'notifications.secret': 'Signing secret',
    'notifications.secretHint': 'Secret hint',
    'notifications.secretPlaceholder': 'Leave empty if unused',
    'notifications.channelTimezone': 'Timezone',
    'notifications.channelTimezoneHint': 'Timezone hint',
    'notifications.channelEnabled': 'Enable this channel',
    'notifications.testSend': 'Send test',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save changes',
    'notifications.channelsEmpty': 'No channels',
    'modal.genericError': 'Error',
  }[key] ?? key)

  beforeEach(() => {
    vi.clearAllMocks()
    swrData = {
      '/api/settings/notification-channels': {
        channels: [
          {
            id: 1,
            user_id: 1,
            type: 'feishu_webhook',
            name: 'Team',
            webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
            secret: null,
            timezone: 'UTC+8',
            enabled: 1,
            created_at: '',
            updated_at: '',
          },
        ],
      },
    }
  })

  it('shows stored timezone in the channel list', async () => {
    render(<NotificationChannelsSection t={t} />)
    await waitFor(() => {
      expect(screen.getByText('UTC+8')).toBeTruthy()
    })
  })

  it('submits default timezone when creating a channel', async () => {
    mockApiPost.mockResolvedValue({})
    render(<NotificationChannelsSection t={t} />)

    await user.click(screen.getByText('Add channel'))
    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'New Channel')
    await user.type(inputs[1], 'https://open.feishu.cn/open-apis/bot/v2/hook/new-token')
    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/settings/notification-channels', {
        type: 'feishu_webhook',
        name: 'New Channel',
        webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/new-token',
        secret: null,
        timezone: 'UTC+8',
        enabled: true,
      })
    })
  })
})
