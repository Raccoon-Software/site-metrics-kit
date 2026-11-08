// Boots the Express and Web-standard examples on free localhost ports and
// checks each one over HTTP, the way the dashboard does: status codes first,
// then a real pull validated with protocol/schema.ts.
//
//   node scripts/e2e.ts

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

import { createApp } from '../examples/express/server.ts'
import { serveWebHandler } from '../examples/shared/nodeServer.ts'
import { handler } from '../examples/web-standard/handler.ts'
import { addDays, fetchSiteMetrics } from '../protocol/schema.ts'

const TOKEN = 'e2e-token'
const listen = (server: Server): Promise<string> =>
  new Promise((resolve) => {
    const done = () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/site-metrics`)
    if (server.listening) done()
    else server.once('listening', done)
  })

const servers: Array<[string, Server]> = [
  ['express', createApp().listen(0)],
  ['web-standard', await serveWebHandler('/site-metrics', handler)],
]

const to = addDays(new Date().toISOString().slice(0, 10), -1)
const range = { from: addDays(to, -89), to }
let failed = false

for (const [name, server] of servers) {
  const url = await listen(server)
  try {
    delete process.env.SEO_DASHBOARD_TOKEN
    assert.equal((await fetch(`${url}?from=${range.from}&to=${to}`)).status, 404, 'no token configured -> 404')

    process.env.SEO_DASHBOARD_TOKEN = TOKEN
    const auth = { Authorization: `Bearer ${TOKEN}` }
    assert.equal((await fetch(`${url}?from=${range.from}&to=${to}`)).status, 401, 'missing token -> 401')
    assert.equal((await fetch(`${url}?from=${to}&to=${range.from}`, { headers: auth })).status, 400, 'reversed range -> 400')

    const res = await fetchSiteMetrics(url, TOKEN, range)
    assert.ok(res.ok, res.ok ? '' : res.error)
    assert.ok(res.data.series.length > 0, 'series is empty')
    console.log(`ok   ${name}: 404/401/400 as expected, 90-day pull valid (${res.data.series.length} points)`)
  } catch (error) {
    failed = true
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`)
  } finally {
    server.close()
  }
}

process.exit(failed ? 1 : 0)
