export const NOTIFICATION_TIMEZONE_OPTIONS = [
  'UTC-12',
  'UTC-11',
  'UTC-10',
  'UTC-9',
  'UTC-8',
  'UTC-7',
  'UTC-6',
  'UTC-5',
  'UTC-4',
  'UTC-3',
  'UTC-2',
  'UTC-1',
  'UTC',
  'UTC+1',
  'UTC+2',
  'UTC+3',
  'UTC+4',
  'UTC+5',
  'UTC+6',
  'UTC+7',
  'UTC+8',
  'UTC+9',
  'UTC+10',
  'UTC+11',
  'UTC+12',
  'UTC+13',
  'UTC+14',
] as const

export type NotificationTimezone = (typeof NOTIFICATION_TIMEZONE_OPTIONS)[number]

export const DEFAULT_NOTIFICATION_TIMEZONE: NotificationTimezone = 'UTC+8'

export function isNotificationTimezone(value: string): value is NotificationTimezone {
  return (NOTIFICATION_TIMEZONE_OPTIONS as readonly string[]).includes(value)
}

export function parseNotificationTimezoneOffsetMinutes(value: string): number | null {
  if (!isNotificationTimezone(value)) return null
  if (value === 'UTC') return 0
  const sign = value.includes('+') ? 1 : -1
  const hours = Number(value.slice(4))
  if (!Number.isInteger(hours)) return null
  return sign * hours * 60
}
