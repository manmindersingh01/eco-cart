import { z } from 'zod'
import { parseEnv, secretString } from '../config.ts'
import { isLocalHost } from './client.ts'
import { EMBEDDING_DIMENSIONS } from './embed.ts'
import type { AiSettings } from './index.ts'

/*
 * The AI settings both programs read at startup (design doc 3.2, backend
 * spec step 17). AI_ENABLED is required, so every environment decides
 * explicitly: a key that is missing in production can never switch AI off
 * without anyone noticing.
 */

const isProduction = (env: NodeJS.ProcessEnv) => env.NODE_ENV === 'production'

// An empty line such as `AI_API_KEY=` in a .env file means "not set".
const blankAsMissing = (value: unknown) => (value === '' ? undefined : value)

const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess(blankAsMissing, schema.optional())

const required = (schema: z.ZodType<string, string>) =>
  z.preprocess(
    blankAsMissing,
    z
      .string({
        error: (issue) =>
          issue.input === undefined
            ? 'is required when AI_ENABLED is true'
            : 'must be text',
      })
      .pipe(schema),
  )

/** An endpoint address; in production a real provider over https. */
const endpointUrl = (env: NodeJS.ProcessEnv) =>
  z
    .url({ error: 'must be an address like https://openrouter.ai/api/v1' })
    .refine(
      (value) => !isProduction(env) || new URL(value).protocol === 'https:',
      'must use https in production, so the key is never sent in the clear',
    )
    .refine(
      (value) => !isProduction(env) || !isLocalHost(new URL(value).hostname),
      'is a local address, such as the test server; production needs a real provider',
    )

const modelName = z.string().trim().min(1, 'must name a model')

/**
 * The AI settings, or null when AI_ENABLED is false. Throws one error that
 * names every wrong variable, without printing any value.
 */
export function loadAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): AiSettings | null {
  const { AI_ENABLED } = parseEnv(
    z.object({
      AI_ENABLED: z.enum(['true', 'false'], {
        error: 'must be true or false',
      }),
    }),
    env,
  )
  // Switched off: no AI call is made, so nothing else is read.
  if (AI_ENABLED === 'false') return null

  const key = secretString(env, 16)
  const config = parseEnv(
    z
      .object({
        AI_BASE_URL: required(endpointUrl(env)),
        AI_API_KEY: required(key),
        AI_CHAT_MODEL: required(modelName),
        AI_VISION_MODEL: required(modelName),
        AI_EMBED_MODEL: required(modelName),
        AI_EMBED_DIMENSIONS: z.literal(String(EMBEDDING_DIMENSIONS), {
          error: `must be ${EMBEDDING_DIMENSIONS}, the size of product_embeddings.embedding`,
        }),
        AI_EMBED_BASE_URL: optional(endpointUrl(env)),
        AI_EMBED_API_KEY: optional(key),
      })
      .refine(
        (values) =>
          (values.AI_EMBED_BASE_URL === undefined) ===
          (values.AI_EMBED_API_KEY === undefined),
        {
          path: ['AI_EMBED_API_KEY'],
          message: 'must be set together with AI_EMBED_BASE_URL, or neither',
        },
      ),
    env,
  )

  const chat = { baseUrl: config.AI_BASE_URL, apiKey: config.AI_API_KEY }
  return {
    chat,
    embed:
      config.AI_EMBED_BASE_URL && config.AI_EMBED_API_KEY
        ? { baseUrl: config.AI_EMBED_BASE_URL, apiKey: config.AI_EMBED_API_KEY }
        : chat,
    chatModel: config.AI_CHAT_MODEL,
    visionModel: config.AI_VISION_MODEL,
    embedModel: config.AI_EMBED_MODEL,
    embedDimensions: EMBEDDING_DIMENSIONS,
  }
}
