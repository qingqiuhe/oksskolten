import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocaleContext } from '../../lib/i18n'
import { FeedEditDialog } from './feed-edit-dialog'

function renderDialog(overrides: Partial<React.ComponentProps<typeof FeedEditDialog>> = {}) {
  const props = {
    name: 'Example Feed',
    iconUrl: 'https://cdn.example.com/avatar.png',
    feedUrl: 'https://example.com',
    onNameChange: vi.fn(),
    onIconUrlChange: vi.fn(),
    onSubmit: vi.fn(),
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
})
