import { XMLParser } from 'fast-xml-parser'
import { getSetting } from './db.js'
import { buildRssHubTwitterUserUrl, normalizeRssHubBaseUrl, parseXAccountInput } from '../shared/social-sources.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
})

const SOCIAL_RSSHUB_BASE_URL_CACHE_MS = 5_000
let cachedSocialRssHubBaseUrl: string | null = null
let cachedSocialRssHubBaseUrlUntil = 0

export class SocialFeedError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

export function invalidateSocialRssHubBaseUrlCache(): void {
  cachedSocialRssHubBaseUrl = null
  cachedSocialRssHubBaseUrlUntil = 0
}

export function getSocialRssHubBaseUrl(now = Date.now()): string | null {
  if (cachedSocialRssHubBaseUrl !== null && now < cachedSocialRssHubBaseUrlUntil) {
    return cachedSocialRssHubBaseUrl || null
  }
  const stored = getSetting('social.rsshub_base_url')
  cachedSocialRssHubBaseUrl = stored ? normalizeRssHubBaseUrl(stored) ?? '' : ''
  cachedSocialRssHubBaseUrlUntil = now + SOCIAL_RSSHUB_BASE_URL_CACHE_MS
  return cachedSocialRssHubBaseUrl || null
}

export function resolveXSocialFeed(input: string): { handle: string; profileUrl: string; rssUrl: string } {
  const rsshubBaseUrl = getSocialRssHubBaseUrl()
  if (!rsshubBaseUrl) {
    throw new SocialFeedError('RSSHub instance is not configured', 400)
  }

  const parsed = parseXAccountInput(input)
  if (!parsed) {
    throw new SocialFeedError('Enter an X handle or profile URL', 400)
  }

  return {
    handle: parsed.handle,
    profileUrl: parsed.profileUrl,
    rssUrl: buildRssHubTwitterUserUrl(rsshubBaseUrl, parsed.handle),
  }
}

export async function probeRssFeedUrl(feedUrl: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new SocialFeedError('Failed to reach the RSSHub feed URL', 400)
  }

  if (!response.ok) {
    throw new SocialFeedError(`RSSHub feed returned HTTP ${response.status}`, 400)
  }

  const body = await response.text()
  let parsed: Record<string, unknown>
  try {
    parsed = parser.parse(body) as Record<string, unknown>
  } catch {
    throw new SocialFeedError('RSSHub feed did not return valid XML', 400)
  }

  if (!parsed.rss && !parsed.feed) {
    throw new SocialFeedError('RSSHub feed did not return a readable feed', 400)
  }
}
