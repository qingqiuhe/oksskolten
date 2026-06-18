import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsPage } from './settings-page'

let meData: { role?: 'owner' | 'admin' | 'member' } | undefined
let swrKeys: Array<string | null> = []

vi.mock('swr', () => ({
  default: (key: string | null) => {
    swrKeys.push(key)
    return {
      data: key === '/api/me'
        ? meData
        : key === '/api/auth/methods'
          ? { password: { enabled: true }, passkey: { enabled: false, count: 0 }, github: { enabled: false } }
          : undefined,
      mutate: vi.fn(),
    }
  },
}))

vi.mock('../app', () => ({
  useAppLayout: () => ({
    settings: {},
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
  }),
}))

vi.mock('../components/settings/password-settings', () => ({ PasswordSettings: () => <div>Password Settings</div> }))
vi.mock('../components/settings/passkey-settings', () => ({ PasskeySettings: () => <div>Passkey Settings</div> }))
vi.mock('../components/settings/github-oauth-settings', () => ({ GitHubOAuthSettings: () => <div>GitHub OAuth Settings</div> }))
vi.mock('../components/settings/api-token-settings', () => ({ ApiTokenSettings: () => <div>API Token Settings</div> }))
vi.mock('../components/settings/image-storage-settings', () => ({ ImageStorageSettings: () => <div>Image Storage Settings</div> }))
vi.mock('./settings/general-tab', () => ({ GeneralTab: () => <div>General Tab</div> }))
vi.mock('./settings/appearance-tab', () => ({ AppearanceTab: () => <div>Appearance Tab</div> }))
vi.mock('./settings/data-tab', () => ({ DataTab: () => <div>Data Tab</div> }))
vi.mock('./settings/members-tab', () => ({ MembersTab: () => <div>Members Tab</div> }))
vi.mock('./settings/sections/provider-config-section', () => ({ ProviderConfigSection: () => <div>Provider Config Section</div> }))
vi.mock('./settings/sections/task-model-section', () => ({ TaskModelSection: () => <div>Task Model Section</div> }))
vi.mock('./settings/sections/notification-channels-section', () => ({ NotificationChannelsSection: () => <div>Notification Channels Section</div> }))
vi.mock('./settings/sections/notification-tasks-section', () => ({ NotificationTasksSection: () => <div>Notification Tasks Section</div> }))

describe('SettingsPage', () => {
  beforeEach(() => {
    meData = { role: 'member' }
    swrKeys = []
  })

  function renderPage(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/:tab" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('shows the notifications tab in settings navigation', () => {
    renderPage('/settings/general')
    expect(screen.getAllByText('Messages & Alerts').length).toBeGreaterThan(0)
  })

  it('renders notification content only in the notifications tab', () => {
    renderPage('/settings/notifications')
    expect(screen.getByText('Notification Channels Section')).toBeTruthy()
    expect(screen.getByText('Notification Tasks Section')).toBeTruthy()
    expect(swrKeys.filter(key => key === '/api/settings/notification-channels')).toHaveLength(1)
    expect(swrKeys.filter(key => key === '/api/me')).toHaveLength(1)
  })

  it('keeps integration focused on ai settings only', () => {
    renderPage('/settings/integration')
    expect(screen.getByText('Provider Config Section')).toBeTruthy()
    expect(screen.getByText('Task Model Section')).toBeTruthy()
    expect(screen.queryByText('Notification Channels Section')).toBeNull()
  })

  it('shares current user data with the data tab', () => {
    meData = { role: 'owner' }
    renderPage('/settings/data')

    expect(screen.getByText('Data Tab')).toBeTruthy()
    expect(swrKeys.filter(key => key === '/api/me')).toHaveLength(1)
  })

  it('shares security auth method data across security sections', () => {
    renderPage('/settings/security')

    expect(screen.getByText('Password Settings')).toBeTruthy()
    expect(screen.getByText('Passkey Settings')).toBeTruthy()
    expect(screen.getByText('GitHub OAuth Settings')).toBeTruthy()
    expect(swrKeys.filter(key => key === '/api/auth/methods')).toHaveLength(1)
    expect(swrKeys.filter(key => key === '/api/me')).toHaveLength(1)
  })
})
