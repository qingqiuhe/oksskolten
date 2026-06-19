import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsTransferSection } from './settings-transfer-section'

const mockFetchSettingsExportBlob = vi.fn()
const mockPreviewSettingsImport = vi.fn()
const mockImportSettingsBundle = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetchSettingsExportBlob: (...args: unknown[]) => mockFetchSettingsExportBlob(...args),
  previewSettingsImport: (...args: unknown[]) => mockPreviewSettingsImport(...args),
  importSettingsBundle: (...args: unknown[]) => mockImportSettingsBundle(...args),
}))

vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

const result = {
  ok: true,
  summary: {
    instanceSettings: { created: 1, updated: 0, skipped: 0 },
    userSettings: { created: 0, updated: 2, skipped: 0 },
    customLlmProviders: { created: 0, updated: 0, skipped: 1 },
    notificationChannels: { created: 1, updated: 0, skipped: 0 },
  },
  warnings: ['Skipped custom LLM provider DeepSeek because api_key was redacted'],
  errors: [],
}

describe('SettingsTransferSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchSettingsExportBlob.mockResolvedValue(new Blob(['{}'], { type: 'application/json' }))
    mockPreviewSettingsImport.mockResolvedValue(result)
    mockImportSettingsBundle.mockResolvedValue(result)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('exports without secrets by default', async () => {
    render(<SettingsTransferSection />)
    await user.click(screen.getByText('Export Settings'))
    await waitFor(() => {
      expect(mockFetchSettingsExportBlob).toHaveBeenCalledWith(false)
    })
  })

  it('passes includeSecrets when the checkbox is enabled', async () => {
    render(<SettingsTransferSection />)
    await user.click(screen.getByLabelText('Include sensitive configuration'))
    await user.click(screen.getByText('Export Settings'))
    await waitFor(() => {
      expect(mockFetchSettingsExportBlob).toHaveBeenCalledWith(true)
    })
  })

  it('previews an imported JSON bundle before confirming import', async () => {
    render(<SettingsTransferSection />)
    const file = new File([JSON.stringify({ app: 'oksskolten', version: 1 })], 'settings.json', { type: 'application/json' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText('Import Preview')).toBeTruthy()
      expect(screen.getByText(/customLlmProviders:/)).toBeTruthy()
      expect(screen.getByText(/Skipped custom LLM provider/)).toBeTruthy()
    })

    await user.click(screen.getByTestId('confirm-import-btn'))
    await waitFor(() => {
      expect(mockImportSettingsBundle).toHaveBeenCalledWith({ app: 'oksskolten', version: 1 })
    })
  })
})
