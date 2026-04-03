export const DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES = 60
export const MIN_NOTIFICATION_CHECK_INTERVAL_MINUTES = 5
export const MAX_NOTIFICATION_CHECK_INTERVAL_MINUTES = 1440

export const DEFAULT_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE = 5
export const MIN_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE = 1
export const MAX_NOTIFICATION_MAX_ARTICLES_PER_MESSAGE = 20

export const DEFAULT_NOTIFICATION_MAX_TITLE_CHARS = 100
export const MIN_NOTIFICATION_MAX_TITLE_CHARS = 1
export const MAX_NOTIFICATION_MAX_TITLE_CHARS = 300

export const DEFAULT_NOTIFICATION_MAX_BODY_CHARS = 1000
export const MIN_NOTIFICATION_MAX_BODY_CHARS = 1
export const MAX_NOTIFICATION_MAX_BODY_CHARS = 1000

const TRUNCATION_SUFFIX = '…'

export function truncateNotificationText(text: string | null | undefined, maxChars: number): string | null {
  if (text == null) return null

  const normalized = text.trim()
  if (!normalized) return null

  const chars = Array.from(normalized)
  if (chars.length <= maxChars) {
    return normalized
  }

  if (maxChars <= 0) {
    return null
  }

  if (maxChars === 1) {
    return TRUNCATION_SUFFIX
  }

  const visibleChars = chars.slice(0, maxChars - 1).join('').trimEnd()
  return `${visibleChars || chars[0]}${TRUNCATION_SUFFIX}`
}
