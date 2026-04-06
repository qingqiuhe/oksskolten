import { afterEach, describe, expect, it, vi } from 'vitest'

describe('scroll restoration helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('saves and restores a positive scroll position', async () => {
    Object.defineProperty(window, 'scrollY', { value: 320, writable: true, configurable: true })
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo

    const { saveScrollPosition, restoreScrollPosition } = await import('./use-scroll-restoration')

    saveScrollPosition('/articles')
    restoreScrollPosition('/articles')

    expect(scrollTo).toHaveBeenCalledWith(0, 320)
  })

  it('does not restore when the saved position is missing or zero', async () => {
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo
    const { saveScrollPosition, restoreScrollPosition } = await import('./use-scroll-restoration')

    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
    saveScrollPosition('/zero')
    restoreScrollPosition('/missing')
    restoreScrollPosition('/zero')

    expect(scrollTo).not.toHaveBeenCalled()
  })
})
