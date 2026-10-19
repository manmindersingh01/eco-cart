import { createHash } from 'node:crypto'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { aiRequests } from '../../db/schema/index.ts'
import {
  ForbiddenError,
  NotConfiguredError,
  TooManyRequestsError,
} from '../../errors.ts'
import {
  AiProviderError,
  usageOfFailure,
  type AiUsage,
  type ModelReply,
} from '../../lib/ai/client.ts'
import type { AiModels } from '../../lib/ai/index.ts'
import { getSetting } from '../settings/service.ts'
import { indianDayStart, nextIndianMidnight } from './days.ts'
import { AI_FEATURES, type AiFeature } from './types.ts'

/*
 * Every AI call goes through callAi (backend spec step 17, design doc 5.12):
 * the cache first, then the daily limits, then the model, and a row in
 * ai_requests for every call that reached the model. The model is called
 * between two short transactions, never inside one, so a slow provider never
 * holds a database lock.
 *
 * A call a seller waits for in the background, such as a listing draft
 * (step 19), is queued instead: queueAiCall checks the cache and the limits
 * and writes a `queued` row in the request's transaction, and the job makes
 * the call with runQueuedAiCall, so the row is the seller's place in the
 * day's limit from the moment they ask.
 */

export interface LimitRule {
  /** Counts against `ai_daily_limit_platform`. */
  platform: boolean
  /** Counts against the seller's `ai_daily_limit_seller`; the call must name its seller. */
  seller: boolean
}

/**
 * What each feature's calls count against (backend spec step 17), fixed
 * here so that no caller can leave a call out of a limit. A cache hit counts
 * against nothing.
 *
 * - Screening counts only against the platform, so a seller who used up
 *   their own calls can still submit a listing for review.
 * - Embeddings count against nothing: one approved import of a few hundred
 *   products needs thousands of them, at a tiny fraction of a chat call's
 *   price. They are still logged with their cost.
 */
export const LIMIT_RULES: Record<AiFeature, LimitRule> = {
  listing_draft: { platform: true, seller: true },
  import_mapping: { platform: true, seller: true },
  import_fill: { platform: true, seller: true },
  screening: { platform: true, seller: false },
  nl_search: { platform: true, seller: false },
  image_search: { platform: true, seller: false },
  similar: { platform: true, seller: false },
  assistant: { platform: true, seller: false },
  embedding: { platform: false, seller: false },
}

const featuresCountingAgainst = (scope: keyof LimitRule): AiFeature[] =>
  AI_FEATURES.filter((feature) => LIMIT_RULES[feature][scope])
const PLATFORM_FEATURES = featuresCountingAgainst('platform')
const SELLER_FEATURES = featuresCountingAgainst('seller')

// Every check of the daily limits takes this lock for the rest of its short
// transaction, so two calls racing for the last call of the day are counted
// one after the other and cannot both get it.
export const DAILY_LIMITS_LOCK = 17_000_017

/**
 * The cache key: SHA-256 of the feature, the model, and the input, with
 * object keys sorted so the same input always gives the same hash.
 */
export function aiInputHash(
  feature: AiFeature,
  model: string,
  input: unknown,
): string {
  const canonical = JSON.stringify(
    { feature, model, input },
    (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).toSorted(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : value,
  )
  return createHash('sha256').update(canonical).digest('hex')
}

export interface AiCall<K extends keyof AiModels, T> {
  feature: AiFeature
  /** Which model answers: `text`, `vision`, or `embed`. */
  uses: K
  /**
   * The seller the call is for. The call then counts against that seller's
   * daily limit too, and only that seller and administrators can see it.
   */
  sellerId?: string | undefined
  /**
   * The user the call is private to. Buyer-facing features leave it out, so
   * their answers are shared through the cache and the log holds no buyer
   * identity.
   */
  userId?: string | undefined
  /**
   * Everything that decides the answer: the prompt text, the inputs, and the
   * images' addresses. Its hash is the cache key.
   */
  input: unknown
  /**
   * How long a stored answer to the same input may be reused, in seconds.
   * Leave it out to always ask the model.
   */
  cacheSeconds?: number | undefined
  /**
   * The answer's shape. A stored answer is checked against it again before
   * it is reused, so it must accept its own output.
   */
  schema: z.ZodType<T>
  /** Asks the model; usually `(model) => model.json(prompt, schema)`. */
  run: (model: AiModels[K]) => Promise<ModelReply<T>>
}

export interface AiAnswer<T> {
  /** The `ai_requests` row that holds the answer. */
  requestId: string
  value: T
  /** True when the answer came from the cache and nobody was called. */
  cached: boolean
}

function assertCanCallFor(
  context: RequestContext,
  call: { sellerId?: string | undefined; userId?: string | undefined },
): void {
  if (context.role === 'admin' || context.role === 'system') return
  if (
    call.sellerId !== undefined &&
    !(context.role === 'seller' && context.sellerId === call.sellerId)
  ) {
    throw new ForbiddenError('AI calls can only be made for your own business')
  }
  if (
    call.userId !== undefined &&
    !('userId' in context && context.userId === call.userId)
  ) {
    throw new ForbiddenError('AI calls can only be made for your own account')
  }
}

type Reservation<T> =
  | { kind: 'cached'; requestId: string; value: T }
  | { kind: 'reserved'; requestId: string }

async function findCached<T>(
  tx: Transaction,
  call: Pick<
    AiCall<keyof AiModels, T>,
    'feature' | 'sellerId' | 'userId' | 'cacheSeconds' | 'schema'
  >,
  inputHash: string,
  now: Date,
): Promise<{ id: string; value: T } | null> {
  if (call.cacheSeconds === undefined) return null
  const rows = await tx
    .select({ id: aiRequests.id, result: aiRequests.result })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.feature, call.feature),
        eq(aiRequests.inputHash, inputHash),
        eq(aiRequests.status, 'succeeded'),
        sql`${aiRequests.sellerId} is not distinct from ${call.sellerId ?? null}`,
        sql`${aiRequests.userId} is not distinct from ${call.userId ?? null}`,
        gte(
          aiRequests.createdAt,
          new Date(now.getTime() - call.cacheSeconds * 1000),
        ),
      ),
    )
    .orderBy(desc(aiRequests.createdAt))
    .limit(1)
  const [row] = rows
  if (!row) return null
  // An answer stored under an older version of the schema is not reused.
  const checked = call.schema.safeParse(row.result)
  return checked.success ? { id: row.id, value: checked.data } : null
}

/**
 * Today's counted calls (India time) for the platform and, when given, one
 * seller, including rows the caller's row-level security context hides.
 */
export async function countCallsToday(
  tx: Transaction,
  sellerId: string | undefined,
  now: Date,
): Promise<{ platform: number; seller: number }> {
  const result = await tx.execute<{
    platform_calls: number
    seller_calls: number
  }>(
    sql`select * from app.ai_calls_since(${indianDayStart(now)}, ${sellerId ?? null}, ${sql.param(PLATFORM_FEATURES)}::text[], ${sql.param(SELLER_FEATURES)}::text[])`,
  )
  const [row] = result.rows
  return { platform: row!.platform_calls, seller: row!.seller_calls }
}

async function checkDailyLimits(
  tx: Transaction,
  rule: LimitRule,
  sellerId: string | undefined,
  now: Date,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${DAILY_LIMITS_LOCK})`)
  const usage = await countCallsToday(tx, sellerId, now)
  const resetAt = nextIndianMidnight(now)

  const platformLimit = await getSetting(tx, 'ai_daily_limit_platform')
  if (rule.platform && usage.platform >= platformLimit) {
    throw new TooManyRequestsError(
      'Today’s AI calls for EcoKart are used up; more are available after midnight India time',
      { resetAt },
    )
  }
  if (!rule.seller || sellerId === undefined) return
  const sellerLimit = await getSetting(tx, 'ai_daily_limit_seller')
  if (usage.seller >= sellerLimit) {
    throw new TooManyRequestsError(
      `You have used today’s ${sellerLimit} AI calls; more are available after midnight India time`,
      { resetAt },
    )
  }
}

// Long enough for any provider message, short enough to keep the log small.
const MAX_ERROR_LENGTH = 1000

const errorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH)}...`
    : message
}

/**
 * Millionths of a dollar, as a whole number like every other amount we
 * store. A chat call costs a few hundred; a short embedding about two.
 */
const microUsd = (costUsd: number | null): number | null =>
  costUsd === null ? null : Math.round(costUsd * 1_000_000)

type Outcome =
  | { status: 'succeeded'; result: unknown; usage: AiUsage }
  | { status: 'failed'; error: string; usage: AiUsage }
  /** A failed attempt that the job's queue will try again. */
  | { status: 'queued'; error: string; usage: AiUsage }

async function recordOutcome(
  db: Database,
  context: RequestContext,
  requestId: string,
  outcome: Outcome,
  latencyMs: number,
): Promise<void> {
  const cost = microUsd(outcome.usage.costUsd)
  await withContext(db, context, (tx) =>
    tx
      .update(aiRequests)
      .set({
        status: outcome.status,
        result: outcome.status === 'succeeded' ? outcome.result : null,
        error: outcome.status === 'succeeded' ? null : outcome.error,
        // Added up, so a queued call that took several attempts is logged
        // with what all of them used.
        inputTokens: sql`coalesce(${aiRequests.inputTokens}, 0) + ${outcome.usage.inputTokens}`,
        outputTokens: sql`coalesce(${aiRequests.outputTokens}, 0) + ${outcome.usage.outputTokens}`,
        costMicroUsd:
          cost === null
            ? sql`${aiRequests.costMicroUsd}`
            : sql`coalesce(${aiRequests.costMicroUsd}, 0) + ${cost}`,
        latencyMs,
        completedAt: outcome.status === 'queued' ? null : sql`now()`,
      })
      .where(eq(aiRequests.id, requestId)),
  )
}

/** Runs the model for a reserved row and records what happened. */
async function runAndRecord<K extends keyof AiModels, T>(
  db: Database,
  context: RequestContext,
  models: AiModels,
  requestId: string,
  call: AiCall<K, T>,
  retried: (error: unknown) => boolean,
): Promise<T> {
  const started = performance.now()
  let reply: ModelReply<T>
  try {
    reply = await call.run(models[call.uses])
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    try {
      await recordOutcome(
        db,
        context,
        requestId,
        {
          status: retried(error) ? 'queued' : 'failed',
          error: errorText(error),
          usage: usageOfFailure(error),
        },
        latencyMs,
      )
    } catch (recordError) {
      // The caller needs the model's error more than this one.
      console.error(
        `Could not record the failed AI call ${requestId}`,
        recordError,
      )
    }
    throw error
  }
  await recordOutcome(
    db,
    context,
    requestId,
    { status: 'succeeded', result: reply.value, usage: reply.usage },
    Math.round(performance.now() - started),
  )
  return reply.value
}

/** Checks a call before anything is counted, and gives its model and cache key. */
function prepare<K extends keyof AiModels>(
  context: RequestContext,
  models: AiModels | null,
  call: Omit<AiCall<K, unknown>, 'run' | 'schema'>,
): {
  models: AiModels
  rule: LimitRule
  model: AiModels[K]
  inputHash: string
} {
  if (models === null) {
    throw new NotConfiguredError('AI features are switched off')
  }
  assertCanCallFor(context, call)
  const rule = LIMIT_RULES[call.feature]
  if (rule.seller && call.sellerId === undefined) {
    throw new Error(`${call.feature} calls must name the seller they are for`)
  }
  const model = models[call.uses]
  return {
    models,
    rule,
    model,
    inputHash: aiInputHash(call.feature, model.model, call.input),
  }
}

/**
 * The cache, then the daily limits, then a new row with `status`, all in
 * the caller's transaction.
 */
async function reserve<T>(
  tx: Transaction,
  call: Omit<AiCall<keyof AiModels, T>, 'run'>,
  prepared: {
    rule: LimitRule
    model: { provider: string; model: string }
    inputHash: string
  },
  status: 'queued' | 'running',
  now: Date,
): Promise<Reservation<T>> {
  const cached = await findCached(tx, call, prepared.inputHash, now)
  if (cached) {
    return { kind: 'cached', requestId: cached.id, value: cached.value }
  }
  const { rule } = prepared
  if (rule.platform || rule.seller) {
    await checkDailyLimits(tx, rule, call.sellerId, now)
  }
  const [row] = await tx
    .insert(aiRequests)
    .values({
      feature: call.feature,
      userId: call.userId ?? null,
      sellerId: call.sellerId ?? null,
      provider: prepared.model.provider,
      model: prepared.model.model,
      inputHash: prepared.inputHash,
      status,
    })
    .returning({ id: aiRequests.id })
  return { kind: 'reserved', requestId: row!.id }
}

/**
 * Answers one AI call: from the cache when the same input was answered
 * recently enough, otherwise by the model, within the daily limits.
 *
 * Throws NotConfiguredError when AI is switched off, TooManyRequestsError
 * when a daily limit is used up (its `resetAt` is the next midnight India
 * time), and the model's own error (AiProviderError or AiReplyError) after
 * recording it, so each feature decides how to fall back.
 *
 * For example, listing screening (step 20) calls it with the feature
 * `screening`, the product's seller, the vision model, and the prompt and
 * photo addresses as the input.
 */
export async function callAi<K extends keyof AiModels, T>(
  db: Database,
  context: RequestContext,
  models: AiModels | null,
  call: AiCall<K, T>,
  now: Date = new Date(),
): Promise<AiAnswer<T>> {
  const prepared = prepare(context, models, call)
  const reservation = await withContext(db, context, (tx) =>
    reserve(tx, call, prepared, 'running', now),
  )
  if (reservation.kind === 'cached') {
    return {
      requestId: reservation.requestId,
      value: reservation.value,
      cached: true,
    }
  }
  const value = await runAndRecord(
    db,
    context,
    prepared.models,
    reservation.requestId,
    call,
    () => false,
  )
  return { requestId: reservation.requestId, value, cached: false }
}

export type AiQueuedCall<K extends keyof AiModels, T> = Omit<
  AiCall<K, T>,
  'run'
>

export type QueuedAiCall<T> =
  | { kind: 'cached'; requestId: string; value: T }
  | { kind: 'queued'; requestId: string }

/**
 * Queues one AI call for a job, inside the caller's transaction, so the
 * job can be sent in the same transaction: an answer from the cache when
 * there is one, otherwise a `queued` row within the daily limits. The row
 * counts against the limits from now on, so asking many times while the
 * jobs wait cannot go over them.
 *
 * Throws NotConfiguredError when AI is switched off and TooManyRequestsError
 * when a daily limit is used up, like callAi.
 */
export async function queueAiCall<K extends keyof AiModels, T>(
  tx: Transaction,
  context: RequestContext,
  models: AiModels | null,
  call: AiQueuedCall<K, T>,
  now: Date = new Date(),
): Promise<QueuedAiCall<T>> {
  const prepared = prepare(context, models, call)
  const reservation = await reserve(tx, call, prepared, 'queued', now)
  return reservation.kind === 'cached'
    ? reservation
    : { kind: 'queued', requestId: reservation.requestId }
}

/**
 * Makes a queued call from its job. The limits were checked when it was
 * queued, so they are not checked again; `call` must be the same feature,
 * seller, and user, and its input may have changed since (for example a
 * photo added), so the row takes its new cache key.
 *
 * Returns null when the call already finished, for example on a job run
 * twice. Throws the model's error after recording it: a provider failure
 * before the job's `lastAttempt` leaves the row queued for the next
 * attempt, and anything else marks it failed.
 */
export async function runQueuedAiCall<K extends keyof AiModels, T>(
  db: Database,
  context: RequestContext,
  models: AiModels | null,
  requestId: string,
  call: AiCall<K, T>,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<AiAnswer<T> | null> {
  if (models === null) {
    // AI was switched off after the call was queued.
    await failQueuedAiCall(
      db,
      context,
      requestId,
      'AI features are switched off',
    )
    throw new NotConfiguredError('AI features are switched off')
  }
  const prepared = prepare(context, models, call)
  const claimed = await withContext(db, context, (tx) =>
    tx
      .update(aiRequests)
      .set({
        // A row left running by a worker that stopped is run again.
        status: 'running',
        provider: prepared.model.provider,
        model: prepared.model.model,
        inputHash: prepared.inputHash,
      })
      .where(
        and(
          eq(aiRequests.id, requestId),
          eq(aiRequests.feature, call.feature),
          sql`${aiRequests.sellerId} is not distinct from ${call.sellerId ?? null}`,
          sql`${aiRequests.userId} is not distinct from ${call.userId ?? null}`,
          inArray(aiRequests.status, ['queued', 'running']),
        ),
      )
      .returning({ id: aiRequests.id }),
  )
  if (claimed.length === 0) return null
  const value = await runAndRecord(
    db,
    context,
    models,
    requestId,
    call,
    (error) => error instanceof AiProviderError && !lastAttempt,
  )
  return { requestId, value, cached: false }
}

/**
 * Marks a queued call failed without calling anyone, for a job that finds
 * it cannot be made, for example because the product's photos are gone.
 */
export async function failQueuedAiCall(
  db: Database,
  context: RequestContext,
  requestId: string,
  reason: string,
): Promise<void> {
  await withContext(db, context, (tx) =>
    tx
      .update(aiRequests)
      .set({ status: 'failed', error: reason, completedAt: sql`now()` })
      .where(
        and(
          eq(aiRequests.id, requestId),
          inArray(aiRequests.status, ['queued', 'running']),
        ),
      ),
  )
}
