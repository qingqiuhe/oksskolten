import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RetentionSection } from './retention-section'

// --- Mocks ---

const mockApiPatch = vi.fn()
const mockApiPost = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}))

// SWR mock that returns different data per key
let swrData: Record<string, unknown> = {}
const mockMutate = vi.fn()
const mockGlobalMutate = vi.fn()

vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key ? swrData[key] ?? undefined : undefined,
    mutate: mockMutate,
  }),
  useSWRConfig: () => ({ mutate: mockGlobalMutate }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  swrData = {}
})

function setPrefs(prefs: Record<string, string | null>) {
  swrData['/api/settings/preferences'] = prefs
}

function setStats(stats: Partial<{ readEligible: number; unreadEligible: number; readDays: number; unreadDays: number; databaseBytes: number }> = {}) {
  swrData['/api/settings/retention/stats'] = {
    readEligible: 0,
    unreadEligible: 0,
    readDays: 0,
    unreadDays: 0,
    databaseBytes: 0,
    ...stats,
  }
}

describe('RetentionSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  it('renders with OFF selected by default', () => {
    setPrefs({ 'retention.enabled': null, 'retention.read_days': null, 'retention.unread_days': null })
    setStats({ databaseBytes: 1024 })
    render(<RetentionSection />)

    const offRadio = screen.getByLabelText('OFF') as HTMLInputElement
    expect(offRadio.checked).toBe(true)
  })

  it('does not show day inputs when disabled', () => {
    setPrefs({ 'retention.enabled': 'off', 'retention.read_days': null, 'retention.unread_days': null })
    setStats({ databaseBytes: 1024 })
    render(<RetentionSection />)

    expect(screen.queryByDisplayValue('90')).toBeNull()
    expect(screen.queryByText('Clean up now')).toBeNull()
  })

  it('shows day inputs and purge button when enabled', () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 5, unreadEligible: 3, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    expect(screen.getByDisplayValue('90')).toBeTruthy()
    expect(screen.getByDisplayValue('180')).toBeTruthy()
    expect(screen.getByText('Clean up now')).toBeTruthy()
  })

  it('sends default days atomically when toggling ON without existing days', async () => {
    setPrefs({ 'retention.enabled': null, 'retention.read_days': null, 'retention.unread_days': null })
    render(<RetentionSection />)

    await user.click(screen.getByLabelText('ON'))

    expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/preferences', {
      'retention.enabled': 'on',
      'retention.read_days': '90',
      'retention.unread_days': '180',
    })
  })

  it('does not overwrite existing days when toggling ON', async () => {
    setPrefs({ 'retention.enabled': 'off', 'retention.read_days': '30', 'retention.unread_days': '60' })
    render(<RetentionSection />)

    await user.click(screen.getByLabelText('ON'))

    expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/preferences', {
      'retention.enabled': 'on',
    })
  })

  it('reverts invalid read days input on blur', async () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 0, unreadEligible: 0, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    const readInput = screen.getByDisplayValue('90')
    await user.clear(readInput)
    await user.type(readInput, '0')
    await user.tab() // blur

    // Should revert to server value, not save
    expect(mockApiPatch).not.toHaveBeenCalled()
    expect((readInput as HTMLInputElement).value).toBe('90')
  })

  it('reverts decimal read days input on blur', async () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 0, unreadEligible: 0, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    const readInput = screen.getByDisplayValue('90')
    await user.clear(readInput)
    await user.type(readInput, '3.5')
    await user.tab()

    expect(mockApiPatch).not.toHaveBeenCalled()
    expect((readInput as HTMLInputElement).value).toBe('90')
  })

  it('saves valid day value on blur', async () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 0, unreadEligible: 0, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    const readInput = screen.getByDisplayValue('90')
    await user.clear(readInput)
    await user.type(readInput, '60')
    await user.tab()

    expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/preferences', {
      'retention.read_days': '60',
    })
  })

  it('disables purge button when no eligible articles', () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 0, unreadEligible: 0, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    const purgeButton = screen.getByText('Clean up now').closest('button')!
    expect(purgeButton.disabled).toBe(true)
  })

  it('enables purge button when eligible articles exist', () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 5, unreadEligible: 3, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    const purgeButton = screen.getByText('Clean up now').closest('button')!
    expect(purgeButton.disabled).toBe(false)
  })

  it('shows confirm dialog on purge button click', async () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 5, unreadEligible: 3, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    await user.click(screen.getByText('Clean up now'))

    // ConfirmDialog should be rendered with the count
    expect(screen.getByText(/8 articles/)).toBeTruthy()
  })

  it('calls purge API on confirm and shows result', async () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 5, unreadEligible: 3, readDays: 90, unreadDays: 180 })
    mockApiPost.mockResolvedValue({ purged: 8 })
    render(<RetentionSection />)

    await user.click(screen.getByText('Clean up now'))
    // Click OK in the confirm dialog
    await user.click(screen.getByText('OK'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/settings/retention/purge')
      expect(screen.getByText(/Deleted 8 articles/)).toBeTruthy()
    })
  })

  it('displays eligible article counts', () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 12, unreadEligible: 7, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    expect(screen.getByText(/12 read/)).toBeTruthy()
    expect(screen.getByText(/7 unread/)).toBeTruthy()
  })

  it('shows protected note when enabled', () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 0, unreadEligible: 0, readDays: 90, unreadDays: 180 })
    render(<RetentionSection />)

    expect(screen.getByText(/Bookmarked and liked articles are never deleted/)).toBeTruthy()
  })

  it('shows rss database size when disabled', () => {
    setPrefs({ 'retention.enabled': 'off', 'retention.read_days': null, 'retention.unread_days': null })
    setStats({ databaseBytes: 1536 })
    render(<RetentionSection />)

    expect(screen.getByText('Current RSS storage: 1.5 KB')).toBeTruthy()
  })

  it('shows rss database size when enabled', () => {
    setPrefs({ 'retention.enabled': 'on', 'retention.read_days': '90', 'retention.unread_days': '180' })
    setStats({ readEligible: 5, unreadEligible: 3, readDays: 90, unreadDays: 180, databaseBytes: 5 * 1024 * 1024 })
    render(<RetentionSection />)

    expect(screen.getByText('Current RSS storage: 5 MB')).toBeTruthy()
  })
})
