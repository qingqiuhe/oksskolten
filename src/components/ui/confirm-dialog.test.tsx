import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog', () => {
  afterEach(cleanup)

  const defaultProps = {
    title: 'Delete item',
    message: 'Are you sure you want to delete?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders title and message', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('Delete item')).toBeTruthy()
    expect(screen.getByText('Are you sure you want to delete?')).toBeTruthy()
  })

  it('renders default confirm label', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('OK')).toBeTruthy()
  })

  it('renders custom confirm and cancel labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" cancelLabel="Nope" />)
    expect(screen.getByText('Delete')).toBeTruthy()
    expect(screen.getByText('Nope')).toBeTruthy()
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />)

    await userEvent.click(screen.getByText('OK'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />)

    await userEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not close when overlay is clicked (AlertDialog blocks overlay dismiss)', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />)

    // AlertDialog intentionally does not close on overlay click for a11y
    const overlay = document.querySelector('[data-state="open"]')
    if (overlay) {
      await userEvent.click(overlay)
    }
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('applies danger variant when danger prop is true', () => {
    render(<ConfirmDialog {...defaultProps} danger />)
    const confirmButton = screen.getByText('OK')
    expect(confirmButton.className).toContain('bg-error')
  })

  it('applies primary variant by default', () => {
    render(<ConfirmDialog {...defaultProps} />)
    const confirmButton = screen.getByText('OK')
    expect(confirmButton.className).toContain('bg-accent')
  })
})
