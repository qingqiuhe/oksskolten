import { XMLParser } from 'fast-xml-parser'
import { getSetting } from './db.js'
import { buildRssHubTwitterUserUrl, normalizeRssHubBaseUrl, parseXAccountInput } from '../shared/social-sources.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
})

export class SocialFeedError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

export function getSocialRssHubBaseUrl(): string | null {
  const stored = getSetting('social.rsshub_base_url')
  return stored ? normalizeRssHubBaseUrl(stored) : null
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
