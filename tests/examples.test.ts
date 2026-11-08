import { describe, expect, it } from 'vitest'

import { buildDailyQuery, buildPostHogMetrics, readPostHogConfig, ROW_LIMIT } from '../examples/convex/posthogMetrics.ts'
import { buildSampleMetrics } from '../examples/shared/sampleData.ts'
import { handler } from '../examples/web-standard/handler.ts'
import { parseSiteMetrics } from '../protocol/schema.ts'

const range = { from: '2026-08-10', to: '2026-11-07' }

describe('sample data (Express and Web-standard examples)', () => {
  it('passes the dashboard schema for a 90-day pull', () => {
    const result = parseSiteMetrics(buildSampleMetrics(range))
    expect(result.ok ? 'valid' : result.error).toBe('valid')
  })

  it('is deterministic and masks personal data in samples', () => {
    const a = buildSampleMetrics(range, new Date(0))
    expect(buildSampleMetrics(range, new Date(0))).toEqual(a)
    const texts = (a.samples ?? []).flatMap((s) => s.items.map((i) => i.text))
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.join(' ')).not.toMatch(/@example\.org/)
  })

  it('is served by the Web-standard handler', async () => {
    process.env.SEO_DASHBOARD_TOKEN = 'test'
    const res = await handler(
      new Request(`https://example.com/site-metrics?from=${range.from}&to=${range.to}`, { headers: { Authorization: 'Bearer test' } }),
    )
    expect(res.status).toBe(200)
    expect(parseSiteMetrics(await res.json()).ok).toBe(true)
  })
})

describe('Convex + PostHog example', () => {
  it('builds a UTC-day HogQL query from the validated range', () => {
    const query = buildDailyQuery({ from: '2026-11-01', to: '2026-11-03' })
    expect(query).toContain("toDate(toTimeZone(timestamp, 'UTC'))")
    expect(query).toContain("timestamp >= toDateTime('2026-11-01 00:00:00', 'UTC')")
    expect(query).toContain("timestamp < toDateTime('2026-11-04 00:00:00', 'UTC')")
    expect(query).toContain(`LIMIT ${ROW_LIMIT + 1}`)
  })

  it('maps PostHog rows to a valid response', async () => {
    const rows = [
      ['2026-11-01', 'signup_completed', '', 3],
      ['2026-11-01', 'tool_used', 'merge', 5],
      ['2026-11-01', 'tool_used', '(none)', 1],
      ['2026-11-02', 'checkout_started', '', 4],
      ['2026-11-02', 'checkout_completed', '', 1],
      ['2026-11-02', 'unknown_event', '', 9],
    ]
    const body = await buildPostHogMetrics({ from: '2026-11-01', to: '2026-11-03' }, async () => rows, {
      site: 'example.com',
      now: new Date('2026-11-04T00:00:00Z'),
    })
    expect(parseSiteMetrics(body).ok).toBe(true)
    expect(body.series).toEqual([
      { metric: 'signups.completed', date: '2026-11-01', value: 3 },
      { metric: 'tools.used', date: '2026-11-01', dim: '(none)', value: 1 },
      { metric: 'tools.used', date: '2026-11-01', dim: 'merge', value: 5 },
      { metric: 'checkout.completed', date: '2026-11-02', value: 1 },
      { metric: 'checkout.started', date: '2026-11-02', value: 4 },
    ])
    expect(body.warnings).toBeUndefined()
  })

  it('reads PostHog config only when complete and on https', () => {
    expect(readPostHogConfig({})).toBeNull()
    expect(readPostHogConfig({ POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_PROJECT_ID: 'abc' })).toBeNull()
    expect(readPostHogConfig({ POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_PROJECT_ID: '1', POSTHOG_API_HOST: 'http://x' })).toBeNull()
    expect(readPostHogConfig({ POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_PROJECT_ID: '42' })).toEqual({
      apiKey: 'k',
      queryUrl: 'https://eu.posthog.com/api/projects/42/query/',
    })
  })
})
