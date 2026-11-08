// Convex HTTP action for GET /site-metrics. Copy into your convex/ folder
// together with posthogMetrics.ts and the kit's core/ (adjust the import
// paths), then register the route in convex/http.ts (see http.ts here).
//
// The URL is https://<deployment>.convex.site/site-metrics. Set the env on
// the deployment, never in the repo:
//   npx convex env set SEO_DASHBOARD_TOKEN <token from the dashboard> --prod
//   npx convex env set POSTHOG_PERSONAL_API_KEY <key with query:read> --prod
//   npx convex env set POSTHOG_PROJECT_ID <numeric id> --prod
//
// Keep this file in Convex's default runtime (no 'use node'): an httpAction
// can't live in a Node-runtime file. Web Crypto and fetch are available there.

import { createSiteMetricsHandler } from '../../core/index.ts'
import { httpAction } from './_generated/server'
import { buildPostHogMetrics, postHogRunner, readPostHogConfig } from './posthogMetrics.ts'

const handler = createSiteMetricsHandler({
  token: () => process.env.SEO_DASHBOARD_TOKEN,
  build: (range) => {
    const config = readPostHogConfig(process.env)
    // Throwing makes the handler answer 502, so the dashboard keeps its data.
    if (!config) throw new Error('PostHog is not configured')
    return buildPostHogMetrics(range, postHogRunner(config), { site: 'example.com' })
  },
})

export const get = httpAction(async (_ctx, request) => handler(request))
