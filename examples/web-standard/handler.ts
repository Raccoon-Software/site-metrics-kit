// One Web-standard handler for every runtime that speaks Request/Response.
//
// Next.js (App Router), app/site-metrics/route.ts:
//   export { handler as GET } from '<this file>'
//   export const dynamic = 'force-dynamic'
//
// Hono:
//   app.get('/site-metrics', (c) => handler(c.req.raw))
//
// Bun:
//   Bun.serve({ routes: { '/site-metrics': { GET: handler } } })
//
// Cloudflare Workers / Deno Deploy read env per request instead of
// process.env; build the handler inside fetch() with `token: env.SEO_DASHBOARD_TOKEN`.
//
// Run it locally with node:http:
//   SEO_DASHBOARD_TOKEN=dev-token PORT=3001 node examples/web-standard/handler.ts

import { fileURLToPath } from 'node:url'

import { createSiteMetricsHandler } from '../../core/index.ts'
import { serveWebHandler } from '../shared/nodeServer.ts'
import { buildSampleMetrics } from '../shared/sampleData.ts'

export const handler = createSiteMetricsHandler({
  token: () => process.env.SEO_DASHBOARD_TOKEN,
  build: (range) => buildSampleMetrics(range),
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3001)
  await serveWebHandler('/site-metrics', handler, port)
  console.log(`site-metrics on http://localhost:${port}/site-metrics`)
}
