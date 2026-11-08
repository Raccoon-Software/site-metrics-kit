// Conformance check for a site's Site Metrics Protocol endpoint. Copied from seo-dashboard
// (scripts/check-site-metrics.ts); only the import path differs.
//
//   node scripts/check-site-metrics.ts <url> --token <token> [--days 30]
//
// Calls the endpoint for the last N full days, validates the response with the same schema
// the dashboard uses, and prints a summary. Exit code 0 = valid, 1 = invalid or unreachable.
import { fetchSiteMetrics, addDays, LIMITS } from '../protocol/schema.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const url = process.argv[2]
const token = arg('token') ?? process.env.SEO_DASHBOARD_TOKEN
const days = Number(arg('days') ?? 30)

if (!url || url.startsWith('--') || !token) {
  console.error('Usage: node scripts/check-site-metrics.ts <url> --token <token> [--days 30]')
  process.exit(1)
}
if (!Number.isInteger(days) || days < 1 || days > LIMITS.maxRangeDays) {
  console.error(`--days must be 1..${LIMITS.maxRangeDays}`)
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const to = addDays(today, -1)
const from = addDays(to, -(days - 1))

const started = Date.now()
const res = await fetchSiteMetrics(url, token, { from, to })
const ms = Date.now() - started

if (!res.ok) {
  console.error(`INVALID (${ms} ms): ${res.error}`)
  process.exit(1)
}

const d = res.data
const counts = d.metrics.filter((m) => m.kind === 'count')
const ratios = d.metrics.filter((m) => m.kind === 'ratio')
const totals = new Map<string, number>()
for (const p of d.series) totals.set(p.metric, (totals.get(p.metric) ?? 0) + p.value)
const outside = d.series.filter((p) => p.date < from || p.date > to).length

console.log(`VALID ${d.protocol} — ${d.site} (${ms} ms, range ${from}..${to})`)
if (d.warnings?.length) console.log(`warnings: ${d.warnings.join(' | ')}`)
if (outside) console.log(`note: ${outside} series value(s) fall outside the requested range`)
console.log(`\ncount metrics (${counts.length}), total over the range:`)
for (const m of counts) {
  const dims = new Set(d.series.filter((p) => p.metric === m.key && p.dim).map((p) => p.dim))
  const dimNote = dims.size ? `  [${dims.size} × ${m.dimension ?? 'dim'}]` : ''
  console.log(`  ${m.key.padEnd(28)} ${String(totals.get(m.key) ?? 0).padStart(10)}  ${m.label}${dimNote}`)
}
if (ratios.length) {
  console.log(`\nratio metrics (${ratios.length}):`)
  for (const m of ratios) {
    if (m.kind !== 'ratio') continue
    const num = m.ratio.num.reduce((s, k) => s + (totals.get(k) ?? 0), 0)
    const den = m.ratio.den.reduce((s, k) => s + (totals.get(k) ?? 0), 0)
    const v = den ? num / den : null
    const shown = v === null ? '—' : m.format === 'percent' ? `${(v * 100).toFixed(1)} %` : v.toFixed(2)
    console.log(`  ${m.key.padEnd(28)} ${shown.padStart(10)}  ${m.label}`)
  }
}
for (const l of d.lists ?? []) console.log(`\nlist ${l.key}: ${l.rows.length} rows — ${l.label}`)
for (const s of d.samples ?? []) console.log(`samples ${s.key}: ${s.items.length} items — ${s.label}`)
