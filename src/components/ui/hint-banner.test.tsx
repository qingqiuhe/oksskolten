import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HintBanner } from './hint-banner'

// Mock framer-motion to avoid animation complexity
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div>,
  },
}))

describe('HintBanner', () => {
  afterEach(cleanup)

  beforeEach(() => {
    localStorage.clear()
  })

  it('renders children when not dismissed', () => {
    render(<HintBanner storageKey="test-hint">Helpful tip</HintBanner>)
    expect(screen.getByText('Helpful tip')).toBeTruthy()
  })

  it('renders nothing when previously dismissed', () => {
    localStorage.setItem('test-hint', '1')
    const { container } = render(<HintBanner storageKey="test-hint">Helpful tip</HintBanner>)
    expect(container.textContent).toBe('')
  })

  it('dismisses on close button click and persists to localStorage', async () => {
    render(<HintBanner storageKey="test-hint">Helpful tip</HintBanner>)
    await userEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByText('Helpful tip')).toBeNull()
    expect(localStorage.getItem('test-hint')).toBe('1')
  })

  it('uses different storage keys independently', () => {
    localStorage.setItem('hint-a', '1')
    const { container: c1 } = render(<HintBanner storageKey="hint-a">A</HintBanner>)
    expect(c1.textContent).toBe('')
    cleanup()

    const { container: c2 } = render(<HintBanner storageKey="hint-b">B</HintBanner>)
    expect(c2.textContent).toContain('B')
  })
})
