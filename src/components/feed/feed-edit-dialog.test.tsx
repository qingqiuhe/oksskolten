import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocaleContext } from '../../lib/i18n'
import { FeedEditDialog } from './feed-edit-dialog'

function renderDialog(overrides: Partial<React.ComponentProps<typeof FeedEditDialog>> = {}) {
  const props = {
    feed: {
      id: 1,
      name: 'Example Feed',
      url: 'https://example.com',
      icon_url: 'https://cdn.example.com/avatar.png',
      rss_url: 'https://example.com/rss',
      rss_bridge_url: null,
      ingest_kind: 'rss' as const,
      view_type: null,
      category_id: null,
      category_name: null,
      priority_level: 3 as const,
      article_count: 0,
      unread_count: 0,
      articles_per_week: 0,
      latest_published_at: null,
      last_error: null,
      error_count: 0,
      disabled: 0,
      requires_js_challenge: 0,
      type: 'rss' as const,
      etag: null,
      last_modified: null,
      last_content_hash: null,
      next_check_at: null,
      check_interval: null,
      created_at: '2024-01-01T00:00:00Z',
    },
    name: 'Example Feed',
    iconUrl: 'https://cdn.example.com/avatar.png',
    priorityLevel: 3 as const,
    onNameChange: vi.fn(),
    onIconUrlChange: vi.fn(),
    onPriorityLevelChange: vi.fn(),
    onSubmit: vi.fn(),
    onUpdateJsonApiConfig: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }

  render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <FeedEditDialog {...props} />
    </LocaleContext.Provider>,
  )

  return props
}

describe('FeedEditDialog', () => {
  it('renders current name and icon_url', () => {
    renderDialog()

    expect(screen.getByDisplayValue('Example Feed')).toBeTruthy()
    expect(screen.getByDisplayValue('https://cdn.example.com/avatar.png')).toBeTruthy()
    expect(screen.getByText('Avatar preview')).toBeTruthy()
  })

  it('clears icon_url through the clear button', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const props = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Clear avatar' }))

    expect(props.onIconUrlChange).toHaveBeenCalledWith('')
  })

  it('blocks submit for invalid icon_url', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const props = renderDialog({ iconUrl: 'http://cdn.example.com/avatar.png' })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Avatar URL must be a valid https:// URL')).toBeTruthy()
  })

  it('shows JSON API source section for json_api feeds', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      transform_script: '({ response }) => response',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    renderDialog({
      feed: {
        id: 2,
        name: 'JSON Feed',
        url: 'https://example.com/api/stories',
        icon_url: null,
        rss_url: null,
        rss_bridge_url: null,
        ingest_kind: 'json_api',
        view_type: null,
        category_id: null,
        category_name: null,
        priority_level: 3,
        article_count: 0,
        unread_count: 0,
        articles_per_week: 0,
        latest_published_at: null,
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
        created_at: '2024-01-01T00:00:00Z',
      },
      iconUrl: '',
    })

    expect(await screen.findByText('JSON API Source')).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledWith('/api/feeds/2/json-api-config', expect.any(Object))
    fetchSpy.mockRestore()
  })
})
