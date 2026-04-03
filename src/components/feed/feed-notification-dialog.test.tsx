import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { FeedNotificationDialog } from './feed-notification-dialog'

const apiPut = vi.fn().mockResolvedValue(undefined)
const apiDelete = vi.fn().mockResolvedValue(undefined)

const defaultFetcher = async (url: string) => {
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
    max_title_chars: 100,
    max_body_chars: 1000,
    next_check_at: null,
    last_checked_at: null,
    created_at: '2026-03-31T00:00:00Z',
    updated_at: '2026-03-31T00:00:00Z',
    channel_ids: [1],
  }
}

const fetcher = vi.fn(defaultFetcher)

vi.mock('../../lib/fetcher', () => ({
  fetcher: (url: string) => fetcher(url),
  apiPut: (...args: unknown[]) => apiPut(...args),
  apiDelete: (...args: unknown[]) => apiDelete(...args),
}))

function renderDialog() {
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
}

describe('FeedNotificationDialog', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    fetcher.mockImplementation(defaultFetcher)
  })

  it('loads rule state and saves advanced settings changes', async () => {
    renderDialog()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }))

    const inputs = screen.getAllByRole('spinbutton')
    const intervalInput = inputs.find(input => input.getAttribute('max') === '1440')
    const maxArticlesInput = inputs.find(input => input.getAttribute('max') === '20')
    const maxTitleInput = inputs.find(input => input.getAttribute('max') === '300')
    const maxBodyInput = inputs.find(input => input.getAttribute('max') === '1000')
    expect(intervalInput).toHaveProperty('value', '60')
    expect(maxArticlesInput).toHaveProperty('value', '5')
    expect(maxTitleInput).toHaveProperty('value', '100')
    expect(maxBodyInput).toHaveProperty('value', '1000')

    await user.clear(intervalInput as HTMLInputElement)
    await user.type(intervalInput as HTMLInputElement, '30')
    await user.clear(maxArticlesInput as HTMLInputElement)
    await user.type(maxArticlesInput as HTMLInputElement, '4')
    await user.clear(maxTitleInput as HTMLInputElement)
    await user.type(maxTitleInput as HTMLInputElement, '120')
    await user.clear(maxBodyInput as HTMLInputElement)
    await user.type(maxBodyInput as HTMLInputElement, '640')
    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/api/feeds/7/notification-rule', {
        enabled: true,
        delivery_mode: 'digest',
        content_mode: 'title_and_body',
        translate_enabled: true,
        check_interval_minutes: 30,
        max_articles_per_message: 4,
        max_title_chars: 120,
        max_body_chars: 640,
        channel_ids: [1],
      })
    })
  })

  it('renders a highlighted master switch card and keeps advanced settings collapsed by default', async () => {
    renderDialog()

    const enableSwitch = await screen.findByRole('switch', { name: 'Enable notifications for this feed' })
    expect(enableSwitch.getAttribute('aria-checked')).toBe('true')
    expect(enableSwitch.className).toContain('h-8')
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Advanced settings' })).toBeTruthy()
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  })

  it('hides interval, translation, and body limit controls for immediate title-only mode', async () => {
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
        max_title_chars: 80,
        max_body_chars: 900,
        next_check_at: null,
        last_checked_at: null,
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z',
        channel_ids: [1],
      }
    })

    renderDialog()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }))

    expect(screen.queryByText('Check interval (minutes)')).toBeNull()
    expect(screen.queryByText('Auto-translate body preview to Simplified Chinese')).toBeNull()
    expect(screen.queryByText('Body max characters')).toBeNull()

    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/api/feeds/7/notification-rule', {
        enabled: true,
        delivery_mode: 'immediate',
        content_mode: 'title_only',
        translate_enabled: true,
        check_interval_minutes: 60,
        max_articles_per_message: 5,
        max_title_chars: 80,
        max_body_chars: 900,
        channel_ids: [1],
      })
    })
  })

  it('keeps long channel content constrained inside the dialog layout', async () => {
    renderDialog()

    const channelName = await screen.findByText('Team')
    const labelClassName = channelName.closest('label')?.className ?? ''
    expect(labelClassName).toContain('w-full')
    expect(labelClassName).toContain('min-w-0')
  })

  it('uses a viewport-bounded and scrollable dialog shell', async () => {
    renderDialog()

    const dialog = await screen.findByRole('dialog')
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]')
    expect(dialog.className).toContain('overflow-y-auto')
    expect(dialog.className).toContain('overflow-x-hidden')
  })

  it('shows preview copy only on demand and updates it for title-only mode', async () => {
    renderDialog()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.queryByText(/Each article: title up to 100 chars \/ source link \/ minute-level time/)).toBeNull()

    await user.click(screen.getByText('Title only'))
    await user.click(screen.getByRole('button', { name: 'Show message format example' }))

    expect(screen.getByText(/Each article: title up to 100 chars \/ source link \/ minute-level time/)).toBeTruthy()
  })
})
