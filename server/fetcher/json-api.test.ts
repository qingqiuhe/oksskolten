import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, getArticleByUrl } from '../db.js'
import { fetchSingleFeed } from '../fetcher.js'
import {
  fetchAndTransformJsonApiFeed,
  normalizeJsonApiOutput,
  stringifyJsonApiSourceConfig,
} from './json-api.js'

describe('normalizeJsonApiOutput', () => {
  it('accepts array output and drops invalid items', () => {
    const result = normalizeJsonApiOutput([
      {
        url: 'https://example.com/story-1?utm_source=test',
        title: 'Story 1',
        excerpt: 'Summary',
      },
      {
        url: 'http://example.com/story-2',
        title: 'Story 2',
      },
    ])

    expect(result.items).toEqual([
      {
        url: 'https://example.com/story-1',
        title: 'Story 1',
        published_at: null,
        excerpt: 'Summary',
        content_html: null,
        content_text: null,
        og_image: null,
      },
    ])
    expect(result.warnings).toEqual(['items[1] url must use https://'])
  })
})

describe('fetchAndTransformJsonApiFeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches JSON and applies the transform script', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      {
        source_url: 'https://example.com/story-1',
        headline: 'Story 1',
        summary: 'Summary',
        body: 'Body text',
        published_at: '2026-04-13T00:00:00Z',
      },
    ]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'etag': '"abc"',
      },
    }))

    const result = await fetchAndTransformJsonApiFeed({
      endpointUrl: 'https://93.184.216.34/api/stories',
      transformScript: `({ response }) => response.map(item => ({
        url: item.source_url,
        title: item.headline,
        excerpt: item.summary,
        content_text: item.body,
        published_at: item.published_at,
      }))`,
      skipCache: true,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].content_text).toBe('Body text')
    expect(result.etag).toBe('"abc"')
  })
})

describe('fetchSingleFeed with ingest_kind=json_api', () => {
  beforeEach(() => {
    setupTestDb()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores inline content without fetching the article page again', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
      {
        source_url: 'https://example.com/story-1',
        headline: 'Story 1',
        summary: 'Summary',
        body: 'Inline body text',
        published_at: '2026-04-13T00:00:00Z',
      },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const feed = createFeed({
      name: 'Aligned News',
      url: 'https://93.184.216.34/api/stories',
      ingest_kind: 'json_api',
      source_config_json: stringifyJsonApiSourceConfig({
        version: 1,
        transform_script: `({ response }) => response.map(item => ({
          url: item.source_url,
          title: item.headline,
          excerpt: item.summary,
          content_text: item.body,
          published_at: item.published_at,
        }))`,
      }),
    })

    await fetchSingleFeed(feed)

    const article = getArticleByUrl('https://example.com/story-1')
    expect(article?.full_text).toBe('Inline body text')
    expect(article?.excerpt).toBe('Summary')
    expect(fetchSpy.mock.calls.some(([url]) => url === 'https://example.com/story-1')).toBe(false)
  })
})
