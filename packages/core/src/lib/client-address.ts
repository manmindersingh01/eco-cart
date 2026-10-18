/*
 * The visitor's IP address, for per-address limits and audit entries
 * (backend spec step 9).
 *
 * Every proxy in front of the web app appends the address it received the
 * request from to X-Forwarded-For, so only the entries those proxies added
 * can be trusted; anything to their left is whatever the visitor sent. With
 * the load balancer alone the visitor is the last entry, and with CloudFront
 * in front of it the second to last. TRUSTED_PROXY_COUNT says how many
 * proxies there are. Without any (local development) Next.js fills the
 * header from the connection when the browser sent none.
 */

const MAX_PROXIES = 5

/** TRUSTED_PROXY_COUNT: 1 (the default) to 5. Checked at startup too. */
export function trustedProxyCount(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = env.TRUSTED_PROXY_COUNT
  if (value === undefined || value === '') return 1
  const count = Number(value)
  if (!/^\d+$/.test(value) || count < 1 || count > MAX_PROXIES) {
    throw new Error(
      `TRUSTED_PROXY_COUNT must be a whole number from 1 to ${MAX_PROXIES}`,
    )
  }
  return count
}

/** The address the nearest trusted proxy saw, or null when there is none. */
export function clientAddress(
  headers: Headers | undefined,
  proxies: number = trustedProxyCount(),
): string | null {
  const entries = (headers?.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  // Fewer entries than proxies means the request skipped one, for example a
  // health check sent straight to the container; the first is all there is.
  return entries[Math.max(0, entries.length - proxies)] ?? null
}
