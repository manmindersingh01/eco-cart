import {
  clientAddress,
  ConflictError,
  ForbiddenError,
  NotConfiguredError,
  NotFoundError,
  NotSignedInError,
  TooManyRequestsError,
  ValidationError,
} from '@ecokart/core'

/*
 * One place that turns the errors services throw into HTTP answers, so every
 * route answers the same way: { "error": "...", "issues"?: [...] }.
 */

const answer = (status: number, message: string) =>
  Response.json({ error: message }, { status })

function tooManyRequests(error: TooManyRequestsError): Response {
  const response = answer(429, error.message)
  if (error.resetAt) {
    // Whole seconds, never 0: a client told to retry at once would only be
    // refused again within the same second.
    const seconds = Math.ceil((error.resetAt.getTime() - Date.now()) / 1000)
    response.headers.set('retry-after', String(Math.max(1, seconds)))
  }
  return response
}

function errorResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    return Response.json(
      { error: error.message, issues: error.issues },
      { status: 400 },
    )
  }
  if (error instanceof NotSignedInError) return answer(401, error.message)
  if (error instanceof ForbiddenError) return answer(403, error.message)
  if (error instanceof NotFoundError) return answer(404, error.message)
  if (error instanceof ConflictError) return answer(409, error.message)
  if (error instanceof NotConfiguredError) return answer(503, error.message)
  if (error instanceof TooManyRequestsError) return tooManyRequests(error)
  // Anything else is a bug: Next.js logs it and answers 500 without details.
  throw error
}

/** Wraps a route handler so expected errors become the answers above. */
export function handleErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/** The request body as JSON, or a 400 if it is not JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ValidationError('The request body must be JSON')
  }
}

/** The visitor's address, for audit logs and per-address limits. */
export function clientIp(request: Request): string | null {
  return clientAddress(request.headers)
}

/** `?cursor=...&limit=20` from a list request, as list services take them. */
export function pageQuery(request: Request): {
  cursor?: string
  limit?: number
} {
  const query = new URL(request.url).searchParams
  const cursor = query.get('cursor')
  const limit = query.get('limit')
  return {
    ...(cursor ? { cursor } : {}),
    ...(limit === null ? {} : { limit: Number(limit) }),
  }
}
