import { describe, expect, it, vi } from 'vitest'

import {
  buildSeries,
  checkToken,
  clip,
  createSiteMetricsHandler,
  daysOf,
  envelope,
  parseRange,
  redactPersonalData,
  tokensMatch,
} from '../core/index.ts'
import { parseSiteMetrics } from '../protocol/schema.ts'

const params = (query: string) => new URLSearchParams(query)
const request = (query: string, authorization?: string) =>
  new Request(`https://example.com/site-metrics${query}`, { headers: authorization ? { Authorization: authorization } : {} })

describe('parseRange', () => {
  it('accepts inclusive UTC ranges up to 120 days', () => {
    expect(parseRange(params('from=2026-11-01&to=2026-11-01'))).toEqual({ from: '2026-11-01', to: '2026-11-01' })
    expect(parseRange(params('from=2026-07-11&to=2026-11-07'))).toEqual({ from: '2026-07-11', to: '2026-11-07' })
  })

  it.each([
    '',
    'from=2026-11-01',
    'from=2026-11-1&to=2026-11-03',
    'from=2026-02-30&to=2026-03-01',
    'from=2026-11-03&to=2026-11-01',
    'from=2026-07-10&to=2026-11-07',
    'from=2026-11-01&to=2026-11-02&to=2026-11-03',
  ])('rejects %j', (query) => {
    expect(parseRange(params(query))).toHaveProperty('error')
  })

  it('lists every day of a range', () => {
    expect(daysOf({ from: '2026-02-27', to: '2026-03-01' })).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })
})

describe('auth', () => {
  it('compares tokens of any length', async () => {
    expect(await tokensMatch('secret', 'secret')).toBe(true)
    expect(await tokensMatch('secre', 'secret')).toBe(false)
    expect(await tokensMatch('secretx', 'secret')).toBe(false)
  })

  it('is disabled without a configured token and strict about the header', async () => {
    expect(await checkToken(request(''), undefined)).toBe('disabled')
    expect(await checkToken(request(''), '  ')).toBe('disabled')
    for (const header of [undefined, 'Bearer ', 'Bearer nope', 'secret', 'Basic secret', 'bearer secret']) {
      expect(await checkToken(request('', header), 'secret')).toBe('denied')
    }
    expect(await checkToken(request('', 'Bearer secret'), 'secret')).toBe('ok')
  })
})

describe('buildSeries', () => {
  it('sums duplicates, drops zeros and points outside the range', () => {
    const range = { from: '2026-11-01', to: '2026-11-02' }
    expect(
      buildSeries(
        [
          { metric: 'a', date: '2026-11-01', value: 2 },
          { metric: 'a', date: '2026-11-01', value: 3 },
          { metric: 'a', date: '2026-11-02', value: 0 },
          { metric: 'a', date: '2026-10-31', value: 9 },
          { metric: 'b', date: '2026-11-02', dim: 'x', value: 1 },
          { metric: 'b', date: '2026-11-02', dim: 'y', value: Number.NaN },
        ],
        range,
      ),
    ).toEqual([
      { metric: 'a', date: '2026-11-01', value: 5 },
      { metric: 'b', date: '2026-11-02', dim: 'x', value: 1 },
    ])
  })
})

describe('redact', () => {
  it('masks e-mails and long numbers, then clips', () => {
    expect(redactPersonalData('mail a.b@example.org or call 600 700 800')).toBe('mail [e-mail] or call [number]')
    expect(redactPersonalData('code 62.01.Z, year 2026')).toBe('code 62.01.Z, year 2026')
    expect(clip(`  ${'x'.repeat(600)}  `, 500)).toHaveLength(500)
  })
})

describe('createSiteMetricsHandler', () => {
  const body = () =>
    envelope({
      site: 'example.com',
      metrics: [{ key: 'a.count', label: 'A', kind: 'count' }],
      series: [{ metric: 'a.count', date: '2026-11-01', value: 1 }],
      now: new Date('2026-11-02T00:00:00Z'),
    })

  it('answers 404 / 401 / 400 before calling build', async () => {
    const build = vi.fn(body)
    const off = createSiteMetricsHandler({ token: undefined, build })
    const on = createSiteMetricsHandler({ token: 'secret', build })
    const off404 = await off(request('?from=2026-11-01&to=2026-11-01', 'Bearer secret'))
    expect(off404.status).toBe(404)
    expect(await off404.text()).toBe('')
    expect((await on(request('?from=2026-11-01&to=2026-11-01', 'Bearer nope'))).status).toBe(401)
    expect((await on(request('?from=2026-11-02&to=2026-11-01', 'Bearer secret'))).status).toBe(400)
    expect(build).not.toHaveBeenCalled()
  })

  it('reads a token function on every request', async () => {
    let token: string | undefined
    const handler = createSiteMetricsHandler({ token: () => token, build: body })
    expect((await handler(request('?from=2026-11-01&to=2026-11-01', 'Bearer t'))).status).toBe(404)
    token = 't'
    expect((await handler(request('?from=2026-11-01&to=2026-11-01', 'Bearer t'))).status).toBe(200)
  })

  it('returns a valid body with no-store, and 502 when build throws', async () => {
    const ok = await createSiteMetricsHandler({ token: 's', build: body })(request('?from=2026-11-01&to=2026-11-01', 'Bearer s'))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(parseSiteMetrics(await ok.json()).ok).toBe(true)

    const onError = vi.fn()
    const failing = createSiteMetricsHandler({
      token: 's',
      build: () => {
        throw new Error('db down')
      },
      onError,
    })
    const res = await failing(request('?from=2026-11-01&to=2026-11-01', 'Bearer s'))
    expect(res.status).toBe(502)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('leaves empty optional parts out of the envelope', () => {
    expect(Object.keys(body())).toEqual(['protocol', 'site', 'generatedAt', 'metrics', 'series'])
  })
})
