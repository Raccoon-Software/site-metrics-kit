// Bearer token check for GET /site-metrics. Uses Web Crypto only, so it runs
// unchanged in Node, Bun, Deno, Convex, Cloudflare Workers and edge runtimes.

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/**
 * Constant-time token comparison. Hashing first gives both sides the same
 * length, so neither the content nor the length of the secret leaks.
 */
export async function tokensMatch(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** The token from `Authorization: Bearer <token>`, or '' when the header is anything else. */
export function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

export type AuthResult = 'ok' | 'disabled' | 'denied'

/**
 * - `disabled`: no token configured. Answer 404, so the endpoint looks absent
 *   until you set SEO_DASHBOARD_TOKEN.
 * - `denied`: missing or wrong token. Answer 401.
 */
export async function checkToken(request: Request, expected: string | undefined): Promise<AuthResult> {
  const secret = expected?.trim()
  if (!secret) return 'disabled'
  const given = bearerToken(request)
  if (!given || !(await tokensMatch(given, secret))) return 'denied'
  return 'ok'
}
