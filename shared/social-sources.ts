export type FeedSourceKind = 'site' | 'social'
export type SocialSourcePlatform = 'x'

const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/
const X_HOSTS = new Set(['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.x.com', 'mobile.twitter.com'])

function isXHost(hostname: string): boolean {
  return X_HOSTS.has(hostname.toLowerCase())
}

function normalizeHandle(rawHandle: string): string | null {
  const trimmed = rawHandle.trim().replace(/^@+/, '')
  if (!trimmed || !X_HANDLE_RE.test(trimmed)) return null
  return trimmed
}

export function buildXProfileUrl(handle: string): string {
  return `https://x.com/${handle}`
}

export function buildRssHubTwitterUserUrl(baseUrl: string, handle: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/twitter/user/${handle}`
}

export function normalizeRssHubBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') return null
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/+$/, '')
}

export function parseXAccountInput(input: string): { handle: string; profileUrl: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (!trimmed.includes('://')) {
    const handle = normalizeHandle(trimmed)
    return handle ? { handle, profileUrl: buildXProfileUrl(handle) } : null
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' || !isXHost(parsed.hostname)) return null

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 1) return null

  const handle = normalizeHandle(segments[0] ?? '')
  return handle ? { handle, profileUrl: buildXProfileUrl(handle) } : null
}
