/*
 * Requests for calling route handlers directly in tests, the way Next.js
 * calls them for a browser request.
 */

/** A request to `/api{path}`, with JSON `body` and the session `cookie`. */
export const apiRequest = (
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
) =>
  new Request(`http://localhost:3000/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })

/** The second argument Next.js passes to a route with an `[id]` segment. */
export const withId = (id: string) => ({ params: Promise.resolve({ id }) })
