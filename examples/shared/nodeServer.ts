// Serves a Web-standard (Request) => Response handler with node:http, for
// local development and the e2e check. Bun, Deno, Workers and Next.js take
// such a handler directly and don't need this.

import { createServer, type IncomingMessage, type Server } from 'node:http'

export function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) headers.set(name, value.join(', '))
  }
  return new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), { method: req.method, headers })
}

export function serveWebHandler(path: string, handler: (request: Request) => Promise<Response>, port = 0): Promise<Server> {
  const server = createServer(async (req, res) => {
    const request = toWebRequest(req)
    const response =
      new URL(request.url).pathname === path && req.method === 'GET'
        ? await handler(request)
        : new Response('Not found', { status: 404 })
    res.statusCode = response.status
    response.headers.forEach((value, name) => res.setHeader(name, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}
