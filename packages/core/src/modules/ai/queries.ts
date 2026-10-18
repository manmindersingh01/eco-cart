import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { aiRequests } from '../../db/schema/index.ts'
import { ForbiddenError, ValidationError } from '../../errors.ts'
import { isUuid, parseInput, strictObject } from '../../lib/validation.ts'
import { getSetting } from '../settings/service.ts'
import { DAY_MS, indianDate, indianDateStart } from './days.ts'
import { countCallsToday } from './service.ts'
import {
  isAiFeature,
  isAiRequestStatus,
  type AiFeature,
  type AiRequestStatus,
} from './types.ts'

/*
 * The AI usage report for administrators (backend spec step 17): the cost
 * report from design doc 5.12, and where the daily limits can be seen
 * working.
 */

export const DEFAULT_USAGE_DAYS = 30
export const MAX_USAGE_DAYS = 92

export interface AiUsageLine {
  /** The India date, YYYY-MM-DD. */
  date: string
  feature: AiFeature
  calls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  /**
   * What the provider charged, in millionths of a US dollar (OpenRouter
   * bills in dollars). Null when it reported no cost, as DeepSeek direct
   * does.
   */
  costMicroUsd: number | null
}

export interface AiUsageReport {
  from: string
  to: string
  today: {
    date: string
    /** Calls that count against the platform's daily limit. */
    platformCalls: number
    platformLimit: number
  }
  /** Newest day first; days and features without calls are left out. */
  lines: AiUsageLine[]
}

const indiaDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'must be a date like 2026-10-11',
    abort: true,
  })
  .refine((value) => {
    // 2026-02-30 is not a date at all, and some engines roll it over to
    // 2 March, so the date must also come back unchanged.
    const start = indianDateStart(value)
    return !Number.isNaN(start.getTime()) && indianDate(start) === value
  }, 'must be a real date')

const usageQuery = strictObject({
  from: indiaDate.optional(),
  to: indiaDate.optional(),
})

/** Calls, failures, and tokens per India day and feature. Administrators only. */
export async function getAiUsage(
  tx: Transaction,
  context: RequestContext,
  query: { from?: string | undefined; to?: string | undefined },
  now: Date = new Date(),
): Promise<AiUsageReport> {
  if (context.role !== 'admin') {
    throw new ForbiddenError('Only administrators can see AI usage')
  }
  const parsed = parseInput(usageQuery, query, 'The report dates are not valid')
  const today = indianDate(now)
  const to = parsed.to ?? today
  const from =
    parsed.from ??
    indianDate(
      new Date(
        indianDateStart(to).getTime() - (DEFAULT_USAGE_DAYS - 1) * DAY_MS,
      ),
    )
  const days =
    (indianDateStart(to).getTime() - indianDateStart(from).getTime()) / DAY_MS +
    1
  if (days < 1) {
    throw new ValidationError('The report dates are not valid', [
      'from must not be after to',
    ])
  }
  if (days > MAX_USAGE_DAYS) {
    throw new ValidationError('The report dates are not valid', [
      `the report can cover at most ${MAX_USAGE_DAYS} days`,
    ])
  }

  const date = sql<string>`to_char(${aiRequests.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`
  const rows = await tx
    .select({
      date,
      feature: aiRequests.feature,
      calls: sql<number>`count(*)::integer`,
      failedCalls: sql<number>`(count(*) filter (where ${aiRequests.status} = 'failed'))::integer`,
      // Whole numbers far below 2^53, so a JavaScript number holds them.
      inputTokens: sql<number>`coalesce(sum(${aiRequests.inputTokens}), 0)::double precision`,
      outputTokens: sql<number>`coalesce(sum(${aiRequests.outputTokens}), 0)::double precision`,
      costMicroUsd: sql<
        number | null
      >`sum(${aiRequests.costMicroUsd})::double precision`,
    })
    .from(aiRequests)
    .where(
      and(
        gte(aiRequests.createdAt, indianDateStart(from)),
        lt(
          aiRequests.createdAt,
          new Date(indianDateStart(to).getTime() + DAY_MS),
        ),
      ),
    )
    .groupBy(date, aiRequests.feature)
    .orderBy(desc(date), aiRequests.feature)

  const usage = await countCallsToday(tx, undefined, now)
  return {
    from,
    to,
    today: {
      date: today,
      platformCalls: usage.platform,
      platformLimit: await getSetting(tx, 'ai_daily_limit_platform'),
    },
    lines: rows.map(({ date: day, feature, ...totals }) => {
      // The CHECK constraint on ai_requests.feature allows nothing else.
      if (!isAiFeature(feature)) {
        throw new Error(`Unknown AI feature ${feature}`)
      }
      return { date: day, feature, ...totals }
    }),
  }
}

export interface AiRequestView {
  id: string
  feature: AiFeature
  status: AiRequestStatus
  sellerId: string | null
  userId: string | null
  /** The checked answer, once the call succeeded. */
  result: unknown
  createdAt: Date
  completedAt: Date | null
}

/**
 * One AI call of `feature`, if the caller's row-level security context can
 * see it, or null. The feature that made the call checks who may read it.
 */
export async function getAiRequest(
  tx: Transaction,
  feature: AiFeature,
  id: string,
): Promise<AiRequestView | null> {
  if (!isUuid(id)) return null
  const [row] = await tx
    .select({
      id: aiRequests.id,
      feature: aiRequests.feature,
      status: aiRequests.status,
      sellerId: aiRequests.sellerId,
      userId: aiRequests.userId,
      result: aiRequests.result,
      createdAt: aiRequests.createdAt,
      completedAt: aiRequests.completedAt,
    })
    .from(aiRequests)
    .where(and(eq(aiRequests.id, id), eq(aiRequests.feature, feature)))
  if (!row) return null
  // The CHECK constraint on ai_requests.status allows nothing else.
  if (!isAiRequestStatus(row.status)) {
    throw new Error(`Unknown AI request status ${row.status}`)
  }
  return { ...row, feature, status: row.status }
}
