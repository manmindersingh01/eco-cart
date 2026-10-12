import { getAiUsage, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * AI calls, failures, tokens, and cost per India day and feature, with
 * today's calls against the platform limit: `?from=2026-10-01&to=2026-10-11`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const query = new URL(request.url).searchParams
  const report = await withContext(getDatabase(), context, (tx) =>
    getAiUsage(tx, context, {
      from: query.get('from') ?? undefined,
      to: query.get('to') ?? undefined,
    }),
  )
  return Response.json(report)
})
