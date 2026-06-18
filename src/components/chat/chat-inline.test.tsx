import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useChatInline } from './chat-inline'

const { swrKeys } = vi.hoisted(() => ({
  swrKeys: [] as Array<string | null>,
}))

vi.mock('swr', () => ({
  default: (key: string | null) => {
    swrKeys.push(key)
    return { data: undefined }
  },
}))

function Probe({ enabled }: { enabled?: boolean }) {
  useChatInline(42, enabled)
  return null
}

describe('useChatInline', () => {
  beforeEach(() => {
    swrKeys.length = 0
  })

  it('loads article conversations when enabled', () => {
    render(<Probe />)

    expect(swrKeys).toEqual(['/api/chat/conversations?article_id=42'])
  })

  it('skips article conversation discovery when disabled', () => {
    render(<Probe enabled={false} />)

    expect(swrKeys).toEqual([null])
  })
})
