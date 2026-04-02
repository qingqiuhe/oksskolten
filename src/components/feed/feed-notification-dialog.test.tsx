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
          timezone: 'UTC+8',
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
    delivery_mode: 'digest',
    content_mode: 'title_and_body',
    translate_enabled: 1,
    check_interval_minutes: 60,
    max_articles_per_message: 5,
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
    const inputs = screen.getAllByRole('spinbutton')
    const intervalInput = inputs.find(input => input.getAttribute('max') === '1440')
    const maxArticlesInput = inputs.find(input => input.getAttribute('max') === '20')
    expect(intervalInput).toHaveProperty('value', '60')
    expect(maxArticlesInput).toHaveProperty('value', '5')

    await user.clear(intervalInput as HTMLInputElement)
    await user.type(intervalInput as HTMLInputElement, '30')
    await user.clear(maxArticlesInput as HTMLInputElement)
    await user.type(maxArticlesInput as HTMLInputElement, '4')
    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/api/feeds/7/notification-rule', {
        enabled: true,
        delivery_mode: 'digest',
        content_mode: 'title_and_body',
        translate_enabled: true,
        check_interval_minutes: 30,
        max_articles_per_message: 4,
        channel_ids: [1],
      })
    })
  })

  it('hides the interval field in immediate mode', async () => {
    fetcher.mockImplementation(async (url: string) => {
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
              timezone: 'UTC+8',
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
        delivery_mode: 'immediate',
        content_mode: 'title_only',
        translate_enabled: 1,
        check_interval_minutes: 60,
        max_articles_per_message: 5,
        next_check_at: null,
        last_checked_at: null,
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z',
        channel_ids: [1],
      }
    })

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
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/api/feeds/7/notification-rule', {
        enabled: true,
        delivery_mode: 'immediate',
        content_mode: 'title_only',
        translate_enabled: true,
        check_interval_minutes: 60,
        max_articles_per_message: 5,
        channel_ids: [1],
      })
    })
  })

  it('keeps long channel content constrained inside the dialog layout', async () => {
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

    const channelName = await screen.findByText('Team')
    const labelClassName = channelName.closest('label')?.className ?? ''
    expect(labelClassName).toContain('w-full')
    expect(labelClassName).toContain('min-w-0')
  })

  it('switches preview copy for title-only mode', async () => {
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
    await user.click(screen.getByText('Title only'))
    expect(screen.getByText(/Each article: source link \/ minute-level time/)).toBeTruthy()
  })
})
