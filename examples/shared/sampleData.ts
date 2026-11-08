// Stand-in for your own data store, so the examples run without a database.
// It plays a site with a "Was this helpful?" widget and a few tools. Replace
// `feedbackFor` and `toolRunsFor` with real queries; keep the mapping.

import { addDays, buildSeries, clip, daysOf, envelope, redactPersonalData } from '../../core/index.ts'
import type { DateRange, MetricDef, SeriesPoint, SiteList, SiteMetricsBody, SiteSample } from '../../core/index.ts'

export const SITE = 'example.com'
const TOOLS = ['merge', 'split', 'compress'] as const

/** Deterministic pseudo-random integer 0..max-1 per seed, so every run returns the same numbers. */
function noise(seed: string, max: number): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return (h >>> 0) % max
}

interface Feedback {
  day: string
  helpful: boolean
  comment: string | null
}

/** In a real app: SELECT ... FROM feedback WHERE created_at in the range (bucketed by UTC day). */
function feedbackFor(day: string): Feedback[] {
  const up = noise(`up:${day}`, 9)
  const down = noise(`down:${day}`, 4)
  const rows: Feedback[] = []
  for (let i = 0; i < up; i++) rows.push({ day, helpful: true, comment: null })
  for (let i = 0; i < down; i++) {
    const comment = i === 0 && noise(`c:${day}`, 3) === 0 ? `Wrong result, mail me at visitor${day.slice(8)}@example.org` : null
    rows.push({ day, helpful: false, comment })
  }
  return rows
}

/** In a real app: tool runs per UTC day and tool. */
function toolRunsFor(day: string): Array<{ tool: string; runs: number }> {
  return TOOLS.map((tool) => ({ tool, runs: noise(`${tool}:${day}`, 30) }))
}

export const METRICS: MetricDef[] = [
  { key: 'feedback.up', label: 'Helpful votes', group: 'Feedback', kind: 'count', better: 'up', description: '"Yes" votes on the "Was this helpful?" widget.' },
  { key: 'feedback.down', label: 'Not helpful votes', group: 'Feedback', kind: 'count', better: 'down', description: '"No" votes on the same widget.' },
  {
    key: 'feedback.satisfaction', label: 'Satisfaction', group: 'Feedback', kind: 'ratio', better: 'up', format: 'percent',
    ratio: { num: ['feedback.up'], den: ['feedback.up', 'feedback.down'] },
    description: 'Share of "Yes" among all votes. A ratio of counts, so it stays correct over any period.',
  },
  { key: 'tools.runs', label: 'Tool runs', group: 'Tools', kind: 'count', dimension: 'Tool', description: 'Runs per tool and day.' },
]

const LIST_DAYS = 30

export function buildSampleMetrics(range: DateRange, now = new Date()): SiteMetricsBody {
  const points: SeriesPoint[] = []
  for (const day of daysOf(range)) {
    const feedback = feedbackFor(day)
    points.push({ metric: 'feedback.up', date: day, value: feedback.filter((f) => f.helpful).length })
    points.push({ metric: 'feedback.down', date: day, value: feedback.filter((f) => !f.helpful).length })
    for (const { tool, runs } of toolRunsFor(day)) points.push({ metric: 'tools.runs', date: day, dim: tool, value: runs })
  }

  // A ranked list covers a fixed window ending at `to`, whatever the range is.
  const totals = new Map<string, number>()
  for (const day of daysOf({ from: addDays(range.to, -(LIST_DAYS - 1)), to: range.to })) {
    for (const { tool, runs } of toolRunsFor(day)) totals.set(tool, (totals.get(tool) ?? 0) + runs)
  }
  const topTools: SiteList = {
    key: 'top_tools',
    label: 'Most used tools',
    periodDays: LIST_DAYS,
    valueLabel: 'Runs',
    rows: [...totals].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
  }

  // Samples are the newest items up to `to`; free text is masked and clipped.
  const comments: SiteSample = { key: 'feedback.negative_comments', label: 'Comments on "No" votes', items: [] }
  for (let day = range.to; comments.items.length < 10 && day >= addDays(range.to, -59); day = addDays(day, -1)) {
    for (const f of feedbackFor(day)) {
      if (f.comment) comments.items.push({ date: day, text: clip(redactPersonalData(f.comment), 500), meta: { helpful: false } })
    }
  }

  return envelope({
    site: SITE,
    metrics: METRICS,
    series: buildSeries(points, range),
    lists: [topTools],
    samples: [comments],
    now,
  })
}
