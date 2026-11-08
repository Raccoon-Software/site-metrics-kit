// Response types and builders for Site Metrics Protocol v1. Plain TypeScript
// with no dependencies; protocol/schema.ts is the zod validator the dashboard
// itself runs, and the tests check these builders against it.

import type { DateRange } from './range.ts'

export const PROTOCOL = 'site-metrics/v1'

export const LIMITS = {
  metrics: 50,
  series: 20_000,
  lists: 10,
  listRows: 50,
  sampleGroups: 5,
  sampleItems: 50,
  textChars: 500,
  responseBytes: 1_000_000,
  timeoutMs: 20_000,
} as const

type Format = 'number' | 'percent' | 'decimal'

/** Adds up over days and dims. Send one value per day (and per dim, if any). */
export interface CountMetric {
  key: string
  label: string
  group?: string
  description?: string
  kind: 'count'
  better?: 'up' | 'down'
  /** Name of the breakdown, e.g. "Tool"; series points then carry `dim`. */
  dimension?: string
  format?: Format
}

/** Σnum / Σden over the chosen period, computed by the dashboard. Never sent as series. */
export interface RatioMetric {
  key: string
  label: string
  group?: string
  description?: string
  kind: 'ratio'
  better?: 'up' | 'down'
  ratio: { num: string[]; den: string[] }
  format?: Format
}

export type MetricDef = CountMetric | RatioMetric

export interface SeriesPoint {
  metric: string
  date: string
  dim?: string
  value: number
}

export interface SiteList {
  key: string
  label: string
  /** Length of the window ending at `to` that the ranking covers. */
  periodDays?: number
  valueLabel?: string
  rows: Array<{ label: string; value: number; secondary?: string }>
}

export interface SiteSample {
  key: string
  label: string
  items: Array<{ date: string; text: string; meta?: Record<string, string | number | boolean | null> }>
}

export interface SiteMetricsBody {
  protocol: typeof PROTOCOL
  site: string
  generatedAt?: string
  warnings?: string[]
  metrics: MetricDef[]
  series: SeriesPoint[]
  lists?: SiteList[]
  samples?: SiteSample[]
}

/**
 * Normalizes raw points for the response: drops points outside the range,
 * sums duplicates of the same (metric, date, dim) and drops zeros.
 *
 * The dashboard replaces every day of the requested window with what you
 * return, so a missing point means 0. Return every non-zero value for the
 * whole window on every call, not just what changed.
 */
export function buildSeries(points: Iterable<SeriesPoint>, range: DateRange): SeriesPoint[] {
  const totals = new Map<string, SeriesPoint>()
  for (const p of points) {
    if (!p.value || !Number.isFinite(p.value) || p.date < range.from || p.date > range.to) continue
    const id = `${p.metric}\u0000${p.date}\u0000${p.dim ?? ''}`
    const seen = totals.get(id)
    if (seen) seen.value += p.value
    else totals.set(id, p.dim === undefined ? { metric: p.metric, date: p.date, value: p.value } : { ...p })
  }
  return [...totals.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric) || (a.dim ?? '').localeCompare(b.dim ?? ''),
  )
}

export interface EnvelopeInput {
  site: string
  metrics: MetricDef[]
  series: SeriesPoint[]
  lists?: SiteList[]
  samples?: SiteSample[]
  warnings?: string[]
  now?: Date
}

/** Wraps the parts in the protocol envelope; empty optional parts are left out. */
export function envelope(input: EnvelopeInput): SiteMetricsBody {
  const body: SiteMetricsBody = {
    protocol: PROTOCOL,
    site: input.site,
    generatedAt: (input.now ?? new Date()).toISOString(),
    metrics: input.metrics,
    series: input.series,
  }
  if (input.lists?.length) body.lists = input.lists
  if (input.samples?.length) body.samples = input.samples
  if (input.warnings?.length) body.warnings = input.warnings
  return body
}
