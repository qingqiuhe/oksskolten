/**
 * Normalize chat failures into stable UI categories (issue #8).
 *
 * Categories:
 * - scope_mismatch           — the conversation scope changed underneath the turn
 * - provider_setup_required  — provider/API key not configured, auth errors
 * - provider_failure         — the LLM provider rejected or failed the request
 * - network_interrupted      — transport-level interruption (network, abort, timeout)
 * - unknown                  — everything else
 */
export type ChatErrorCategory =
  | 'scope_mismatch'
  | 'provider_setup_required'
  | 'provider_failure'
  | 'network_interrupted'
  | 'unknown'

export interface NormalizedChatError {
  category: ChatErrorCategory
  message: string
  detail?: string
}

const SCOPE_MISMATCH_PATTERNS = [
  /scope mismatch/i,
  /Conversation scope mismatch/i,
  /scope_mismatch/i,
] as const

const SETUP_PATTERNS = [
  /api key/i,
  /API_KEY_NOT_SET/i,
  /OPENAI_KEY_NOT_SET/i,
  /not configured/i,
  /provider setup/i,
  /provider_setup/i,
  /CLAUDE.*auth/i,
  /claude.*not found/i,
  /401/,
  /403/,
  /UNAUTHORIZED/i,
  /CONFIG_REQUIRED/i,
  /OPENAI_COMPATIBLE_CONFIG_REQUIRED/i,
] as const

const NETWORK_PATTERNS = [
  /fetch failed/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ECONNRESET/i,
  /network/i,
  /timeout/i,
  /abort/i,
  /ETIMEDOUT/i,
  /socket/i,
] as const

const PROVIDER_PATTERNS = [
  /provider/i,
  /upstream/i,
  /5dd/,
  /rate limit/i,
  /429/,
  /context.*exceed/i,
  /context_length/i,
  /MAX_TOOL/i,
  /tool call rounds/i,
] as const

export function normalizeChatError(err: unknown): NormalizedChatError {
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown error')

  if (SCOPE_MISMATCH_PATTERNS.some(pattern => pattern.test(message))) {
    return { category: 'scope_mismatch', message }
  }
  if (SETUP_PATTERNS.some(pattern => pattern.test(message))) {
    return { category: 'provider_setup_required', message }
  }
  if (NETWORK_PATTERNS.some(pattern => pattern.test(message))) {
    return { category: 'network_interrupted', message }
  }
  if (PROVIDER_PATTERNS.some(pattern => pattern.test(message))) {
    return { category: 'provider_failure', message }
  }
  return { category: 'unknown', message }
}
