// Date range of a Site Metrics request: inclusive UTC days, YYYY-MM-DD.

export const MAX_RANGE_DAYS = 120

export interface DateRange {
  from: string
  to: string
}

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar day in YYYY-MM-DD form (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  return DATE_RE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

/** Shifts a YYYY-MM-DD day by whole UTC days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Inclusive number of UTC days between two YYYY-MM-DD dates. */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

/** Every day of the range, oldest first. Handy for zero-filling. */
export function daysOf({ from, to }: DateRange): string[] {
  return Array.from({ length: daySpan(from, to) }, (_, i) => addDays(from, i))
}

/**
 * Validates the `from`/`to` query parameters: each given exactly once, real
 * calendar days, from <= to, at most MAX_RANGE_DAYS inclusive. Answer 400 with
 * the returned error otherwise.
 */
export function parseRange(params: URLSearchParams): DateRange | { error: string } {
  const from = params.getAll('from')
  const to = params.getAll('to')
  if (from.length !== 1 || to.length !== 1 || !isCalendarDate(from[0]) || !isCalendarDate(to[0])) {
    return { error: 'from and to must be dates in YYYY-MM-DD format' }
  }
  if (from[0] > to[0]) return { error: 'from must not be after to' }
  if (daySpan(from[0], to[0]) > MAX_RANGE_DAYS) {
    return { error: `The range must not exceed ${MAX_RANGE_DAYS} days` }
  }
  return { from: from[0], to: to[0] }
}
