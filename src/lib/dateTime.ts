export function parseUtcLikeDate(value: string | null): Date | null {
  if (!value) return null
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatLocalDateTime(value: string | null, emptyLabel: string): string {
  const date = parseUtcLikeDate(value)
  return date ? date.toLocaleString() : emptyLabel
}
