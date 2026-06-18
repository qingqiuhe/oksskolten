import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from './__tests__/helpers/testDb.js'
import { getDb, upsertSetting } from './db.js'
import {
  getSocialRssHubBaseUrl,
  invalidateSocialRssHubBaseUrlCache,
  resolveXSocialFeed,
} from './social-feeds.js'

beforeEach(() => {
  setupTestDb()
  invalidateSocialRssHubBaseUrlCache()
})

describe('social RSSHub settings cache', () => {
  it('normalizes the configured base URL', () => {
    upsertSetting('social.rsshub_base_url', 'https://rsshub.example.com/')

    expect(getSocialRssHubBaseUrl()).toBe('https://rsshub.example.com')
  })

  it('reuses a short-lived cached base URL for social feed resolution', () => {
    upsertSetting('social.rsshub_base_url', 'https://rsshub.example.com/')
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    expect(resolveXSocialFeed('@alice').rssUrl).toBe('https://rsshub.example.com/twitter/user/alice')
    expect(resolveXSocialFeed('@bob').rssUrl).toBe('https://rsshub.example.com/twitter/user/bob')

    expect(preparedSql.filter(sql => sql.includes('FROM instance_settings') && sql.includes('WHERE key = ?'))).toHaveLength(1)
  })
})
