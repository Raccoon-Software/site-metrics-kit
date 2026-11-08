// Copied verbatim from seo-dashboard (convex/lib/siteMetrics/protocol.ts @ 10e025a).
// The dashboard's copy is the source of truth. Do not edit here: run `bun run sync:protocol`.

import { z } from 'zod'

/**
 * Site Metrics Protocol v1 — the response a site returns from
 * `GET <site>/site-metrics?from=YYYY-MM-DD&to=YYYY-MM-DD` (Bearer token).
 * Spec: docs/site-metrics-protocol.md. Keep the two in sync.
 */
export const PROTOCOL = 'site-metrics/v1'

export const LIMITS = {
  maxRangeDays: 120,
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

const key = z.string().regex(/^[a-z0-9_.-]{1,64}$/, 'key must match ^[a-z0-9_.-]{1,64}$')
const label = z.string().min(1).max(120)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
const dim = z.string().min(1).max(120)

const countMetric = z.object({
  key,
  label,
  group: label.optional(),
  description: z.string().max(500).optional(),
  kind: z.literal('count'),
  better: z.enum(['up', 'down']).optional(),
  dimension: label.optional(),
  format: z.enum(['number', 'percent', 'decimal']).optional(),
})

const ratioMetric = z.object({
  key,
  label,
  group: label.optional(),
  description: z.string().max(500).optional(),
  kind: z.literal('ratio'),
  better: z.enum(['up', 'down']).optional(),
  ratio: z.object({
    num: z.array(key).min(1).max(10),
    den: z.array(key).min(1).max(10),
  }),
  format: z.enum(['number', 'percent', 'decimal']).optional(),
})

export const metricDef = z.discriminatedUnion('kind', [countMetric, ratioMetric])

const point = z.object({
  metric: key,
  date,
  dim: dim.optional(),
  value: z.number().finite(),
})

const list = z.object({
  key,
  label,
  periodDays: z.number().int().positive().max(366).optional(),
  valueLabel: label.optional(),
  rows: z
    .array(
      z.object({
        label: z.string().min(1).max(LIMITS.textChars),
        value: z.number().finite(),
        secondary: z.string().max(200).optional(),
      }),
    )
    .max(LIMITS.listRows),
})

const sample = z.object({
  key,
  label,
  items: z
    .array(
      z.object({
        date,
        // Longer texts are cut, not rejected — a site should not fail on one long comment.
        text: z.string().min(1).transform((s) => s.slice(0, LIMITS.textChars)),
        meta: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
      }),
    )
    .max(LIMITS.sampleItems),
})

export const siteMetricsResponse = z
  .object({
    protocol: z.literal(PROTOCOL),
    site: z.string().min(1).max(200),
    generatedAt: z.string().optional(),
    warnings: z.array(z.string().max(500)).max(20).optional(),
    metrics: z.array(metricDef).max(LIMITS.metrics),
    series: z.array(point).max(LIMITS.series),
    lists: z.array(list).max(LIMITS.lists).optional(),
    samples: z.array(sample).max(LIMITS.sampleGroups).optional(),
  })
  .superRefine((r, ctx) => {
    const kinds = new Map<string, 'count' | 'ratio'>()
    for (const m of r.metrics) {
      if (kinds.has(m.key)) ctx.addIssue({ code: 'custom', message: `duplicate metric key "${m.key}"` })
      kinds.set(m.key, m.kind)
    }
    for (const m of r.metrics) {
      if (m.kind !== 'ratio') continue
      for (const k of [...m.ratio.num, ...m.ratio.den]) {
        if (kinds.get(k) !== 'count') {
          ctx.addIssue({ code: 'custom', message: `ratio "${m.key}" refers to "${k}", which is not a count metric` })
        }
      }
    }
    const unknown = new Set<string>()
    for (const p of r.series) {
      if (kinds.get(p.metric) !== 'count') unknown.add(p.metric)
    }
    for (const k of unknown) {
      ctx.addIssue({ code: 'custom', message: `series value for "${k}", which is not a declared count metric` })
    }
  })

export type MetricDef = z.infer<typeof metricDef>
export type SiteMetricsResponse = z.infer<typeof siteMetricsResponse>
export type SeriesPoint = SiteMetricsResponse['series'][number]
export type SiteList = NonNullable<SiteMetricsResponse['lists']>[number]
export type SiteSample = NonNullable<SiteMetricsResponse['samples']>[number]

export type ParseResult =
  | { ok: true; data: SiteMetricsResponse }
  | { ok: false; error: string }

/** Validate a decoded JSON body. Errors are short, path-prefixed and human readable. */
export function parseSiteMetrics(body: unknown): ParseResult {
  const res = siteMetricsResponse.safeParse(body)
  if (res.success) return { ok: true, data: res.data }
  const lines = res.error.issues.slice(0, 8).map((i) => {
    const path = i.path.length ? i.path.join('.') + ': ' : ''
    return path + i.message
  })
  const more = res.error.issues.length > 8 ? ` (+${res.error.issues.length - 8} more)` : ''
  return { ok: false, error: lines.join('; ') + more }
}

/** Shift a YYYY-MM-DD date by whole days (UTC). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Inclusive number of days between two YYYY-MM-DD dates. */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * Window for the next pull. Re-fetches the last 2 known days (late events, PostHog
 * ingestion lag); on first connect backfills `backfillDays`. Never includes today
 * (a partial day). Returns null when there is nothing new to fetch.
 */
export function nextWindow(
  lastDate: string | undefined,
  today: string,
  backfillDays = 90,
): { from: string; to: string } | null {
  const to = addDays(today, -1)
  const earliest = addDays(to, -(LIMITS.maxRangeDays - 1))
  let from = lastDate ? addDays(lastDate, -2) : addDays(to, -(backfillDays - 1))
  if (from < earliest) from = earliest
  if (from > to) return null
  return { from, to }
}

/** Fetch and validate one site's endpoint. Shared by the Convex action and the CLI checker. */
export async function fetchSiteMetrics(
  url: string,
  token: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ParseResult & { status?: number }> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return { ok: false, error: 'Invalid endpoint URL.' }
  }
  if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) {
    return { ok: false, error: 'Endpoint must use https.' }
  }
  target.searchParams.set('from', range.from)
  target.searchParams.set('to', range.to)

  let res: Response
  try {
    res = await fetchImpl(target, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(LIMITS.timeoutMs),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Request failed: ${msg}` }
  }
  if (!res.ok) {
    const hint =
      res.status === 401 ? ' (token rejected)' : res.status === 404 ? ' (endpoint missing or SEO_DASHBOARD_TOKEN unset)' : ''
    return { ok: false, status: res.status, error: `HTTP ${res.status}${hint}` }
  }
  const text = await res.text()
  if (text.length > LIMITS.responseBytes) {
    return { ok: false, status: res.status, error: `Response too large (${text.length} bytes, max ${LIMITS.responseBytes}).` }
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, status: res.status, error: 'Response is not valid JSON.' }
  }
  return { ...parseSiteMetrics(body), status: res.status }
}
