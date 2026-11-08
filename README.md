# site-metrics-kit

Connect any app to the **SEO Dashboard** so it shows your product data (feedback votes, tool runs, sign-ups, top searches, user comments) next to Search Console, GA4 and PageSpeed, and feeds it to the dashboard's AI insights.

You add one endpoint, `GET /site-metrics`, that describes and returns your own numbers. This repo contains the protocol schema, a small dependency-free helper library, runnable examples for Express, Convex and Web-standard runtimes (Next.js, Hono, Bun, Workers), and a conformance check.

Expect about 30 minutes for a first endpoint.

## How data flows

**The dashboard calls you. Your app never pushes anything.**

```
SEO Dashboard ── GET https://your-app/site-metrics?from=2026-08-10&to=2026-11-07 ──▶ your app
              ◀───────────────── JSON (Site Metrics Protocol v1) ───────────────────
```

- Once a day at 04:30 UTC, and when someone clicks **Fetch now**.
- The first pull asks for the last 90 days. Later pulls ask from 2 days before the last stored day up to **yesterday** (UTC); today is never requested.
- The dashboard sends `Authorization: Bearer <token>` and `Accept: application/json`. It waits at most **20 s** and reads at most **1 MB**.

The dashboard also has an internal `POST /ingest` route for its own git and deploy data. It is not meant for apps; use this pull endpoint instead.

## The endpoint

```
GET <your-app>/site-metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <token>
```

| Situation | Answer |
|---|---|
| `SEO_DASHBOARD_TOKEN` not set | `404`, empty body. The feature is off until you set it. |
| Missing or wrong token | `401` `{"error":"Invalid token"}`. Compare in constant time. |
| `from`/`to` missing, repeated, not real dates, `from > to`, or more than **120 days** (inclusive) | `400` `{"error":"..."}` |
| Your data source failed | `5xx`. The dashboard keeps what it has. |
| Otherwise | `200` JSON, `Cache-Control: no-store` |

Server to server only: no CORS, and keep it outside your user login.

`core/handler.ts` implements all of this. You only write the `build(range)` function:

```ts
import { buildSeries, createSiteMetricsHandler, envelope } from './core/index.ts'

export const handler = createSiteMetricsHandler({
  token: () => process.env.SEO_DASHBOARD_TOKEN,
  build: async (range) => {
    const rows = await db.dailyVotes(range.from, range.to) // your query, UTC days
    return envelope({
      site: 'example.com',
      metrics: [
        { key: 'feedback.up', label: 'Helpful votes', kind: 'count', better: 'up' },
        { key: 'feedback.down', label: 'Not helpful votes', kind: 'count', better: 'down' },
        {
          key: 'feedback.satisfaction', label: 'Satisfaction', kind: 'ratio', format: 'percent', better: 'up',
          ratio: { num: ['feedback.up'], den: ['feedback.up', 'feedback.down'] },
        },
      ],
      series: buildSeries(rows.flatMap((r) => [
        { metric: 'feedback.up', date: r.day, value: r.up },
        { metric: 'feedback.down', date: r.day, value: r.down },
      ]), range),
    })
  },
})
```

## The response

```jsonc
{
  "protocol": "site-metrics/v1",
  "site": "example.com",
  "generatedAt": "2026-11-08T04:30:01.000Z",
  "warnings": ["Optional: known, permanent gaps, e.g. days before tracking started"],
  "metrics": [ /* what the dashboard shows, max 50 */ ],
  "series":  [ /* daily values of count metrics, max 20,000 */ ],
  "lists":   [ /* ranked snapshots, max 10 × 50 rows (optional) */ ],
  "samples": [ /* short user texts, max 5 × 50 (optional) */ ]
}
```

The dashboard renders metrics it has never seen from your description of them. Labels and descriptions are shown as they are, so write them in the language your team reads.

### Metrics: only send what adds up

- **`count`**: a number that can be summed over days. For example votes, runs, sign-ups, bytes. Optional `dimension` (e.g. `"Tool"`) splits it; the series points then carry `dim`.
- **`ratio`**: `Σnum / Σden` of count metrics, computed by the dashboard for any period. Averages and rates are always ratios: average rating = `rating_points / ratings`, conversion = `completed / started`. Never send a daily average or a daily percentage as a series: they can't be combined correctly over a month.
- Unique visitors are not additive (one person on two days counts twice). If you must send them, label them honestly ("visitor-days").
- `key` matches `^[a-z0-9_.-]{1,64}$`, by convention `group.name`. **Renaming a key starts a new series.**
- Optional: `group`, `description` (up to 500 characters), `better: "up" | "down"`, `format: "number" | "percent" | "decimal"`.
- Skip what the dashboard already has: it reads traffic (visitors, sessions, pageviews) from PostHog and Google directly. Send what only your app knows.

### Series: return whole days, every time

`{ "metric": "feedback.up", "date": "2026-11-06", "value": 3 }`, plus `"dim"` for a dimension.

**The dashboard deletes every stored day in `from..to` and replaces it with what you return.** So:

- Return **every** non-zero value for the **whole** requested window on every call, not just new rows. A missing point means 0.
- Bucket days in **UTC**. If your database or analytics tool works in another time zone, convert before grouping (`AT TIME ZONE 'UTC'` in Postgres, `toTimeZone(timestamp, 'UTC')` in HogQL).
- If your data source fails, answer `5xx`. An empty `200` would wipe those days.
- Points outside `from..to` are ignored; duplicates of the same (metric, date, dim) are summed. `buildSeries()` normalizes this for you.

### Lists and samples

- **List**: a ranked snapshot for the window ending at `to` (`periodDays` long), e.g. most used tools or most frequent searches. Up to 50 rows of `{ label, value, secondary? }`. Replaced in full on every pull.
- **Sample**: short user texts, newest first, e.g. comments left with a "No" vote. `text` up to 500 characters, flat scalar `meta`. Replaced in full on every pull.
- **No personal data.** These texts are shown in the dashboard and sent to an AI model. Run free text through `redactPersonalData()` (masks e-mails and long numbers) and `clip()`, and never include names, IPs or account ids.

## Connect your app

1. **Implement the endpoint.** Start from the example closest to your stack:
   - `examples/express/server.ts`: Express (or any Node server) with your own database.
   - `examples/convex/`: a Convex HTTP action. `posthogMetrics.ts` builds the metrics from PostHog events, for apps that store no product data themselves.
   - `examples/web-standard/handler.ts`: Next.js route handlers, Hono, Bun, Deno, Cloudflare Workers.

   Copy `core/` into your project (it has no dependencies), or copy just the parts you need.
2. **Deploy it with the token unset.** The endpoint answers `404`, so nothing is exposed yet.
3. **In the dashboard**, open the project → settings → **Dane ze strony** (site data). Paste the endpoint URL (`https` required) and click **Generate token**. The token is shown once; copy it.
4. **Set `SEO_DASHBOARD_TOKEN`** on your server to that token. Keep it in your platform's secret store, never in the repo.
5. Click **Test connection** (asks for the last 7 days, stores nothing), then **Fetch now** (backfills 90 days).
6. If anything looks off, run the conformance check against the live URL:

   ```bash
   bun install
   node scripts/check-site-metrics.ts https://your-app/site-metrics --token "$SEO_DASHBOARD_TOKEN" --days 30
   ```

   It validates the response with the same schema the dashboard uses and prints totals per metric.

Disconnecting the source in the dashboard deletes all data pulled from it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `HTTP 404 (endpoint missing or SEO_DASHBOARD_TOKEN unset)` | The route isn't deployed at that URL, or the env var isn't set on the running server (redeploy or restart after setting it). |
| `HTTP 401 (token rejected)` | The token was regenerated in the dashboard, or a proxy strips the `Authorization` header. |
| `HTTP 400` | Your range parsing is stricter than the protocol, e.g. it rejects a 120-day window. |
| `Request failed: ... timeout` | The response took over 20 s. Pre-aggregate per day, or query fewer rows. |
| `Response too large` | Over 1 MB. Drop zero points (`buildSeries` does), use fewer dims, shorten texts. |
| `series value for "x", which is not a declared count metric` | A series point names a ratio or an undeclared key. |
| Numbers drop to 0 for recent days | Your endpoint returned only the newest rows or an empty `200` after an error. See "return whole days". |
| Days are shifted by one | Days are bucketed in local time instead of UTC. |

## Develop and test

Requires Node 24+ (runs TypeScript directly) and Bun.

```bash
bun install
bun run typecheck
bun run test            # unit tests, validated with protocol/schema.ts
bun run e2e             # boots the Express and Web-standard examples and pulls from them over HTTP
SEO_DASHBOARD_TOKEN=dev bun run example:express   # http://localhost:3000/site-metrics
```

## Layout

```
protocol/schema.ts        the dashboard's zod validator, copied verbatim (zod 4 is its only dependency)
core/                     dependency-free helpers: range, auth, redact, response builders, handler
examples/shared/          sample data store and a node:http adapter
examples/express/         Express server
examples/convex/          Convex HTTP action + PostHog metrics
examples/web-standard/    one handler for Request/Response runtimes
scripts/                  check-site-metrics, e2e, sync-protocol
tests/                    vitest
```

## Keeping the schema in sync

`protocol/schema.ts` is a copy; the dashboard's version is the source of truth. When the protocol changes, run `bun run sync:protocol` (needs read access to the dashboard repo through `gh`, or `--from <local checkout>`), run the tests and commit. New optional fields keep the protocol at `v1`; a breaking change would become `site-metrics/v2`, which the dashboard would announce.

## License

MIT
