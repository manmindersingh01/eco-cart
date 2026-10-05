import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from './columns.ts'
import {
  currentSellerId,
  currentUserId,
  fullAccess,
  webAll,
  webInsert,
  webSelect,
  workerPolicy,
} from './rls.ts'
import { sellers } from './sellers.ts'

/**
 * Every AI call. Serves the three AI operating controls: the per-seller and
 * platform daily limits, the result cache on (feature, input_hash), and the
 * cost report (design doc 5.12).
 */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: uuidPrimaryKey(),
    feature: text('feature').notNull(),
    userId: uuid('user_id').references(() => users.id),
    sellerId: uuid('seller_id').references(() => sellers.id),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    // Hash of the normalised input, used as the cache key.
    inputHash: text('input_hash').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costMicroInr: bigint('cost_micro_inr', { mode: 'number' }),
    status: text('status').notNull().default('queued'),
    result: jsonb('result'),
    error: text('error'),
    latencyMs: integer('latency_ms'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    index('ai_requests_feature_input_hash_idx').on(t.feature, t.inputHash),
    index('ai_requests_seller_id_created_at_idx').on(t.sellerId, t.createdAt),
    index('ai_requests_created_at_idx').on(t.createdAt),
    check(
      'ai_requests_feature_check',
      sql`feature in ('listing_draft', 'import_mapping', 'import_fill', 'nl_search', 'image_search', 'similar', 'assistant', 'screening', 'embedding')`,
    ),
    check(
      'ai_requests_status_check',
      sql`status in ('queued', 'running', 'succeeded', 'failed')`,
    ),
    check(
      'ai_requests_counts_check',
      sql`input_tokens >= 0 and output_tokens >= 0 and cost_micro_inr >= 0 and latency_ms >= 0`,
    ),
    // Rows with no user and no seller are the shared cache; the rest belong
    // to the user or seller who caused them.
    webAll(
      sql`${fullAccess} or (user_id is null and seller_id is null) or user_id = ${currentUserId} or seller_id = ${currentSellerId}`,
    ),
    workerPolicy(),
  ],
).enableRLS()

/** Every search, so zero-result queries feed the catalogue gap report. */
export const searchQueries = pgTable(
  'search_queries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id'),
    sessionId: text('session_id'),
    kind: text('kind').notNull(),
    // Empty for image searches.
    queryText: text('query_text'),
    parsed: jsonb('parsed'),
    resultCount: integer('result_count').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('search_queries_zero_results_created_at_idx')
      .on(t.createdAt)
      .where(sql`result_count = 0`),
    check(
      'search_queries_kind_check',
      sql`kind in ('keyword', 'natural', 'image')`,
    ),
    check(
      'search_queries_counts_check',
      sql`result_count >= 0 and latency_ms >= 0`,
    ),
    webSelect(fullAccess),
    webInsert(
      sql`user_id is null or user_id = ${currentUserId} or ${fullAccess}`,
    ),
    workerPolicy(),
  ],
).enableRLS()
