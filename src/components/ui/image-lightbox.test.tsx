import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageLightbox } from './image-lightbox'

describe('ImageLightbox', () => {
  afterEach(cleanup)

  it('renders nothing when src is null', () => {
    const { container } = render(<ImageLightbox src={null} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders image when src is provided', () => {
    render(<ImageLightbox src="https://example.com/img.png" onClose={vi.fn()} />)
    // alt="" gives role="presentation" not "img"
    const img = document.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://example.com/img.png')
  })

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(<ImageLightbox src="https://example.com/img.png" onClose={onClose} />)
    const backdrop = document.querySelector('.fixed.inset-0')!
    await userEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose when image is clicked', async () => {
    const onClose = vi.fn()
    render(<ImageLightbox src="https://example.com/img.png" onClose={onClose} />)
    await userEvent.click(document.querySelector('img')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn()
    render(<ImageLightbox src="https://example.com/img.png" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
