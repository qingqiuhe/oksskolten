import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FetchScheduleSection } from './fetch-schedule-section'

const mockApiPatch = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
}))

let swrData: Record<string, unknown> = {}
const mockMutate = vi.fn(async (value?: unknown) => {
  if (value !== undefined) {
    swrData['/api/settings/fetch-schedule'] = value
  }
  return value ?? swrData['/api/settings/fetch-schedule']
})

vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key ? swrData[key] ?? undefined : undefined,
    mutate: mockMutate,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  swrData = {
    '/api/settings/fetch-schedule': { min_interval_minutes: 15 },
  }
})

describe('FetchScheduleSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  it('renders the current value from the API', () => {
    render(<FetchScheduleSection />)
    expect(screen.getByDisplayValue('15')).toBeTruthy()
    expect(screen.getByText('This controls the minimum feed fetch interval only. Notification timing is unchanged.')).toBeTruthy()
  })

  it('reverts invalid input on blur', async () => {
    render(<FetchScheduleSection />)

    const input = screen.getByDisplayValue('15')
    await user.clear(input)
    await user.type(input, '0')
    await user.tab()

    expect(mockApiPatch).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('15')
    expect(screen.getByText('Enter a whole number between 1 and 240')).toBeTruthy()
  })

  it('saves a valid value on blur', async () => {
    mockApiPatch.mockResolvedValue({ min_interval_minutes: 5 })
    render(<FetchScheduleSection />)

    const input = screen.getByDisplayValue('15')
    await user.clear(input)
    await user.type(input, '5')
    await user.tab()

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/fetch-schedule', {
        min_interval_minutes: 5,
      })
      expect(screen.getByText('Saved')).toBeTruthy()
    })
  })
})
