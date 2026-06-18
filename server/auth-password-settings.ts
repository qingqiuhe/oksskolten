import { getSetting } from './db.js'

const PASSWORD_AUTH_ENABLED_CACHE_MS = 5_000

let cachedPasswordAuthEnabled: boolean | null = null
let cachedPasswordAuthEnabledUntil = 0

export function invalidatePasswordAuthEnabledCache(): void {
  cachedPasswordAuthEnabled = null
  cachedPasswordAuthEnabledUntil = 0
}

export function isPasswordAuthEnabled(now = Date.now()): boolean {
  if (cachedPasswordAuthEnabled !== null && now < cachedPasswordAuthEnabledUntil) return cachedPasswordAuthEnabled
  cachedPasswordAuthEnabled = getSetting('auth.password_enabled') !== '0'
  cachedPasswordAuthEnabledUntil = now + PASSWORD_AUTH_ENABLED_CACHE_MS
  return cachedPasswordAuthEnabled
}
