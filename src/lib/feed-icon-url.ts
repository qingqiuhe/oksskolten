import { extractDomain } from './url'

export function normalizeFeedIconUrl(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function isValidFeedIconUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function getFeedIconPreviewSrc(iconUrl: string | null | undefined, feedUrl: string): string | null {
  if (iconUrl && isValidFeedIconUrl(iconUrl)) return iconUrl
  const domain = extractDomain(feedUrl)
  return domain ? `https://www.google.com/s2/favicons?sz=64&domain=${domain}` : null
}
