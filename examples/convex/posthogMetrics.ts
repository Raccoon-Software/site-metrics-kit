// Metrics from PostHog events, for apps whose backend stores no product data
// of its own (a static site plus Convex, for example). Pure: the PostHog call
// is injected, so this runs in tests and in Convex's default runtime.
//
// Send only what the dashboard can't get elsewhere. It already reads traffic
// (visitors, sessions, pageviews) from PostHog and Google, so map your
// product events instead: tool runs, sign-ups, checkouts, feedback.

import { addDays, buildSeries, envelope, type DateRange, type MetricDef, type SeriesPoint, type SiteMetricsBody } from '../../core/index.ts'

export interface PostHogEnv {
  POSTHOG_PERSONAL_API_KEY?: string
  POSTHOG_PROJECT_ID?: string
  /** e.g. https://eu.posthog.com or https://us.posthog.com */
  POSTHOG_API_HOST?: string
}

export interface PostHogConfig {
  apiKey: string
  queryUrl: string
}

/** null when PostHog is not (validly) configured; answer 5xx then, never an empty 200. */
export function readPostHogConfig(env: PostHogEnv): PostHogConfig | null {
  const apiKey = env.POSTHOG_PERSONAL_API_KEY?.trim()
  const projectId = env.POSTHOG_PROJECT_ID?.trim()
  if (!apiKey || !projectId || !/^\d+$/.test(projectId)) return null
  let host: URL
  try {
    host = new URL(env.POSTHOG_API_HOST?.trim() || 'https://eu.posthog.com')
  } catch {
    return null
  }
  if (host.protocol !== 'https:') return null
  return { apiKey, queryUrl: `${host.origin}/api/projects/${projectId}/query/` }
}

export type RunQuery = (name: string, query: string) => Promise<unknown[][]>

/** Runs one HogQL query through PostHog's Query API (personal key with query:read). */
export function postHogRunner(config: PostHogConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): RunQuery {
  return async (name, query) => {
    const res = await fetchImpl(config.queryUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, name }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await res.json().catch(() => null)) as { results?: unknown } | null
    if (!res.ok) throw new Error(`PostHog HTTP ${res.status}`)
    if (!body || !Array.isArray(body.results)) throw new Error('PostHog response has no results array')
    return body.results.filter(Array.isArray)
  }
}

/** One count metric per event; `dimensionProperty` splits it by an event property. */
interface EventMetric {
  event: string
  dimensionProperty?: string
  metric: MetricDef & { kind: 'count' }
}

// Your events go here. Names are interpolated into HogQL, so they are
// checked against SAFE_NAME below; never build this list from user input.
export const EVENT_METRICS: EventMetric[] = [
  {
    event: 'signup_completed',
    metric: { key: 'signups.completed', label: 'Sign-ups', group: 'Accounts', kind: 'count', better: 'up' },
  },
  {
    event: 'tool_used',
    dimensionProperty: 'tool',
    metric: { key: 'tools.used', label: 'Tool uses', group: 'Tools', kind: 'count', dimension: 'Tool' },
  },
  {
    event: 'checkout_started',
    metric: { key: 'checkout.started', label: 'Checkouts started', group: 'Checkout', kind: 'count' },
  },
  {
    event: 'checkout_completed',
    metric: { key: 'checkout.completed', label: 'Checkouts completed', group: 'Checkout', kind: 'count', better: 'up' },
  },
]

export const METRICS: MetricDef[] = [
  ...EVENT_METRICS.map((m) => m.metric),
  {
    key: 'checkout.conversion', label: 'Checkout conversion', group: 'Checkout', kind: 'ratio', better: 'up', format: 'percent',
    ratio: { num: ['checkout.completed'], den: ['checkout.started'] },
  },
]

const SAFE_NAME = /^[A-Za-z0-9_$.-]{1,100}$/
for (const m of EVENT_METRICS) {
  if (!SAFE_NAME.test(m.event) || (m.dimensionProperty && !SAFE_NAME.test(m.dimensionProperty))) {
    throw new Error(`Unsafe event or property name in EVENT_METRICS: ${m.event}`)
  }
}

export const ROW_LIMIT = 10_000

/**
 * Daily counts per event (and dimension) in UTC days. PostHog buckets in the
 * project's time zone by default; the protocol wants UTC, hence toTimeZone.
 * `range` must come from parseRange, so the interpolated dates are safe.
 */
export function buildDailyQuery({ from, to }: DateRange): string {
  const nextDay = addDays(to, 1)
  const events = EVENT_METRICS.map((m) => `'${m.event}'`).join(', ')
  const dims = EVENT_METRICS.filter((m) => m.dimensionProperty)
    .map((m) => `event = '${m.event}', ifNull(nullIf(toString(properties.${m.dimensionProperty}), ''), '(none)')`)
  const dimExpr = dims.length ? `multiIf(${dims.join(', ')}, '')` : "''"
  return `SELECT toString(toDate(toTimeZone(timestamp, 'UTC'))) AS day, event, ${dimExpr} AS dim, count() AS n
FROM events
WHERE event IN (${events})
  AND timestamp >= toDateTime('${from} 00:00:00', 'UTC') AND timestamp < toDateTime('${nextDay} 00:00:00', 'UTC')
GROUP BY day, event, dim
LIMIT ${ROW_LIMIT + 1}`
}

export async function buildPostHogMetrics(
  range: DateRange,
  runQuery: RunQuery,
  options: { site: string; now?: Date },
): Promise<SiteMetricsBody> {
  const rows = await runQuery('site-metrics daily', buildDailyQuery(range))
  const byEvent = new Map(EVENT_METRICS.map((m) => [m.event, m]))
  const points: SeriesPoint[] = []
  for (const [day, event, dim, n] of rows) {
    const m = byEvent.get(String(event))
    if (!m) continue
    const value = Number(n)
    const point: SeriesPoint = { metric: m.metric.key, date: String(day), value }
    if (m.dimensionProperty) point.dim = String(dim).slice(0, 120) || '(none)'
    points.push(point)
  }
  return envelope({
    site: options.site,
    metrics: METRICS,
    series: buildSeries(points, range),
    warnings: rows.length > ROW_LIMIT ? [`PostHog returned more than ${ROW_LIMIT} rows; some days are incomplete.`] : [],
    now: options.now,
  })
}
