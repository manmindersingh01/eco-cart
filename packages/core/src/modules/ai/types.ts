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

export type AiRequestStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export const isAiFeature = (value: string): value is AiFeature =>
  (AI_FEATURES as readonly string[]).includes(value)
