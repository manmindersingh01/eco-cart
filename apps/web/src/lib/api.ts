import {
  ConflictError,
  ForbiddenError,
  NotConfiguredError,
  NotFoundError,
  NotSignedInError,
  ValidationError,
} from '@ecokart/core'

/*
 * One place that turns the errors services throw into HTTP answers, so every
 * route answers the same way: { "error": "...", "issues"?: [...] }.
 */

const answer = (status: number, message: string) =>
  Response.json({ error: message }, { status })

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

/** The visitor's address as the load balancer reports it, for audit logs. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim()
  return forwarded || request.headers.get('x-real-ip') || null
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
