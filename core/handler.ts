// The whole GET /site-metrics endpoint as a Web-standard
// (Request) => Promise<Response> function. Mount it in any framework; see
// examples/ for Express, Convex and Web-standard runtimes.

import { checkToken } from './auth.ts'
import { parseRange, type DateRange } from './range.ts'
import type { SiteMetricsBody } from './response.ts'

export interface SiteMetricsHandlerOptions {
  /**
   * The token generated in the dashboard (usually env SEO_DASHBOARD_TOKEN).
   * A function is read on every request, so rotating the env takes effect
   * without a restart. Unset or blank: the endpoint answers 404.
   */
  token: string | undefined | (() => string | undefined)
  /** Builds the response for a validated range. Throw if the data source fails. */
  build: (range: DateRange, request: Request) => SiteMetricsBody | Promise<SiteMetricsBody>
  /** Called with the error when `build` throws; defaults to console.error. */
  onError?: (error: unknown) => void
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

/**
 * Status codes, in the order they are checked:
 * - 404 with no body: no token configured (the feature is off).
 * - 401: missing or wrong bearer token.
 * - 400: bad `from`/`to`.
 * - 502: `build` threw. Never answer 200 with partial or empty data on
 *   failure: the dashboard would replace the stored days with it. A 5xx
 *   makes it keep what it has.
 * - 200 with `Cache-Control: no-store`.
 */
export function createSiteMetricsHandler(options: SiteMetricsHandlerOptions): (request: Request) => Promise<Response> {
  const readToken = typeof options.token === 'function' ? options.token : () => options.token as string | undefined
  const onError = options.onError ?? ((error: unknown) => console.error('site-metrics: build failed', error))

  return async (request) => {
    const auth = await checkToken(request, readToken())
    if (auth === 'disabled') return new Response(null, { status: 404 })
    if (auth === 'denied') return json({ error: 'Invalid token' }, 401)

    const range = parseRange(new URL(request.url).searchParams)
    if ('error' in range) return json({ error: range.error }, 400)

    try {
      return json(await options.build(range, request), 200)
    } catch (error) {
      onError(error)
      return json({ error: 'The data source failed; try again later' }, 502)
    }
  }
}
