// convex/http.ts: add the route next to the ones you already have.
import { httpRouter } from 'convex/server'
import { get as siteMetrics } from './siteMetrics'

const http = httpRouter()
http.route({ path: '/site-metrics', method: 'GET', handler: siteMetrics })
export default http
