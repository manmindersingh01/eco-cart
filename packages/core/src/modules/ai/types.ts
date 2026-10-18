/** What an AI call is for; the CHECK constraint on `ai_requests.feature`. */
export const AI_FEATURES = [
  'listing_draft',
  'import_mapping',
  'import_fill',
  'nl_search',
  'image_search',
  'similar',
  'assistant',
  'screening',
  'embedding',
] as const

export type AiFeature = (typeof AI_FEATURES)[number]

/** Where a call is; the CHECK constraint on `ai_requests.status`. */
export const AI_REQUEST_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
] as const

export type AiRequestStatus = (typeof AI_REQUEST_STATUSES)[number]

export const isAiFeature = (value: string): value is AiFeature =>
  (AI_FEATURES as readonly string[]).includes(value)

export const isAiRequestStatus = (value: string): value is AiRequestStatus =>
  (AI_REQUEST_STATUSES as readonly string[]).includes(value)
