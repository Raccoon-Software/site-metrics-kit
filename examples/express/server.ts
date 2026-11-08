// Express backend with GET /site-metrics.
//
//   SEO_DASHBOARD_TOKEN=dev-token PORT=3000 node examples/express/server.ts
//   curl -H 'Authorization: Bearer dev-token' 'http://localhost:3000/site-metrics?from=2026-11-01&to=2026-11-07'
//
// The route is mounted at the app root, next to your API, not behind your
// user auth or CORS: the dashboard calls it server to server.

import { fileURLToPath } from 'node:url'
import express, { type Express } from 'express'

import { createSiteMetricsHandler } from '../../core/index.ts'
import { toWebRequest } from '../shared/nodeServer.ts'
import { buildSampleMetrics } from '../shared/sampleData.ts'

const siteMetrics = createSiteMetricsHandler({
  // Read on every request, so the endpoint stays 404 until the env is set.
  token: () => process.env.SEO_DASHBOARD_TOKEN,
  // Replace with your own queries (see examples/shared/sampleData.ts).
  build: (range) => buildSampleMetrics(range),
})

export function createApp(): Express {
  const app = express()
  app.get('/site-metrics', async (req, res, next) => {
    try {
      const response = await siteMetrics(toWebRequest(req))
      res.status(response.status)
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      next(error)
    }
  })
  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000)
  createApp().listen(port, () => console.log(`site-metrics on http://localhost:${port}/site-metrics`))
}
