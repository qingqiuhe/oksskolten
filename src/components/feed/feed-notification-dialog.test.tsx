import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { FeedNotificationDialog } from './feed-notification-dialog'

const apiPut = vi.fn().mockResolvedValue(undefined)
const apiDelete = vi.fn().mockResolvedValue(undefined)
const fetcher = vi.fn(async (url: string) => {
  if (url === '/api/settings/notification-channels') {
    return {
      channels: [
        {
          id: 1,
          user_id: null,
          type: 'feishu_webhook',
          name: 'Team',
          webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
          secret: null,
          enabled: 1,
          created_at: '2026-03-31T00:00:00Z',
          updated_at: '2026-03-31T00:00:00Z',
        },
      ],
    }
  }
  return {
    id: 1,
    user_id: null,
    feed_id: 7,
    enabled: 1,
    check_interval_minutes: 60,
    next_check_at: null,
    last_checked_at: null,
    created_at: '2026-03-31T00:00:00Z',
    updated_at: '2026-03-31T00:00:00Z',
    channel_ids: [1],
  }
})

vi.mock('../../lib/fetcher', () => ({
  fetcher: (url: string) => fetcher(url),
  apiPut: (...args: unknown[]) => apiPut(...args),
  apiDelete: (...args: unknown[]) => apiDelete(...args),
}))

describe('FeedNotificationDialog', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads rule state and saves changes', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <FeedNotificationDialog
          feed={{
            id: 7,
            name: 'Example Feed',
            url: 'https://example.com',
            icon_url: null,
            rss_url: null,
            rss_bridge_url: null,
            view_type: null,
            category_id: null,
            last_error: null,
            error_count: 0,
            disabled: 0,
            requires_js_challenge: 0,
            type: 'rss',
            etag: null,
            last_modified: null,
            last_content_hash: null,
            next_check_at: null,
            check_interval: null,
            created_at: '2026-03-31T00:00:00Z',
            category_name: null,
            article_count: 0,
            unread_count: 0,
            articles_per_week: 0,
            latest_published_at: null,
          }}
          onClose={() => {}}
        />
      </SWRConfig>,
    )

    expect(await screen.findByRole('dialog')).toBeTruthy()
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveProperty('value', '60')

    await user.clear(input)
    await user.type(input, '30')
    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/api/feeds/7/notification-rule', {
        enabled: true,
        check_interval_minutes: 30,
        channel_ids: [1],
      })
    })
  })
})
