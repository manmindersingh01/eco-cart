import { z } from 'zod'
import { parseEncryptionKey } from './encryption.ts'

/*
 * Pieces shared by the configuration of each module. Every program reads its
 * environment once at startup and stops with a clear message if anything is
 * missing or wrong, instead of failing on the first request that needs it.
 */

// Every secret in the .env.example files contains this marker, so a copy of
// the example values can never run in production by accident.
const DEVELOPMENT_MARKER = 'development-only'

const isProduction = (env: NodeJS.ProcessEnv) => env.NODE_ENV === 'production'

/** A secret string, refused in production when it is an example value. */
export const secretString = (env: NodeJS.ProcessEnv, minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine(
      (value) => !(isProduction(env) && value.includes(DEVELOPMENT_MARKER)),
      'is the development example value; set a real secret',
    )

/** MESSAGE_ENCRYPTION_KEY: 32 bytes in base64, parsed into a key. */
export const encryptionKey = (env: NodeJS.ProcessEnv) =>
  z
    .string()
    .transform((value, context) => {
      try {
        return parseEncryptionKey(value)
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : String(error),
        })
        return z.NEVER
      }
    })
    .refine(
      (key) =>
        !(
          isProduction(env) &&
          key.toString('latin1').includes(DEVELOPMENT_MARKER)
        ),
      'is the development example value; generate one with `openssl rand -base64 32`',
    )

const LOCAL_CATCHER =
  'is the local Mailpit catcher, which never delivers anything; production needs a real provider'

/**
 * Which service delivers email. Only the local Mailpit catcher exists so
 * far, and it is refused in production, so a sign-in code can never be
 * "sent" into a catcher nobody reads.
 */
export const emailProvider = (env: NodeJS.ProcessEnv) =>
  z
    .enum(['mailpit'])
    .refine(
      (value) => !(isProduction(env) && value === 'mailpit'),
      LOCAL_CATCHER,
    )

/**
 * Which service delivers SMS; `none` keeps phone sign-in switched off. The
 * local Mailpit catcher is refused in production, like for email.
 */
export const smsProvider = (env: NodeJS.ProcessEnv) =>
  z
    .enum(['none', 'mailpit'])
    .refine(
      (value) => !(isProduction(env) && value === 'mailpit'),
      LOCAL_CATCHER,
    )
export type SmsProvider = 'none' | 'mailpit'

/**
 * Parses `env` with `schema`, or throws one error that lists every problem
 * by variable name, without ever printing a value.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  env: NodeJS.ProcessEnv,
): z.infer<T> {
  const result = schema.safeParse(env)
  if (result.success) return result.data
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'environment'} ${issue.message}`,
  )
  throw new Error(`Invalid environment:\n- ${problems.join('\n- ')}`)
}
