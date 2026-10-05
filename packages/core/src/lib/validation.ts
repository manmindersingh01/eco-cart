import { z } from 'zod'
import { ValidationError } from '../errors.ts'

/*
 * Formats used across India-specific data, kept in one place so settings,
 * sellers, and addresses all accept exactly the same values. The database
 * CHECK constraints in the schema use the same patterns.
 */

/** E.164, for example +919812345678 or a landline +912012345678. */
export const phoneNumber = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'must be in international format, like +919812345678',
  )

/** An Indian mobile number, the only kind phone sign-in accepts. */
export const indianMobile = z
  .string()
  .regex(
    /^\+91[6-9]\d{9}$/,
    'must be an Indian mobile number, like +919812345678',
  )

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether `value` looks like a database id, before it reaches a query. */
export const isUuid = (value: string) => UUID.test(value)

/** Two-digit GST state code, for example 27 for Maharashtra. */
export const stateCode = z
  .string()
  .regex(/^\d{2}$/, 'must be a two-digit GST state code, like 27')

export const pincode = z
  .string()
  .regex(/^[1-9]\d{5}$/, 'must be a six-digit PIN code')

export const pan = z
  .string()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'must be a PAN, like AAACE1234F')

export const gstin = z
  .string()
  .regex(
    /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    'must be a GSTIN, like 27AAACE1234F1Z5',
  )

/** A whole number within limits, with messages an administrator can read. */
export const wholeNumber = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .number({ error: 'must be a number' })
    .int('must be a whole number')
    .min(min, `must be at least ${min}`)
    .max(max, `must be at most ${max}`)

/** A whole number of paise that JavaScript holds exactly. */
export const paise = wholeNumber(0)

/** Trimmed text that is not empty and not longer than `max` characters. */
export const text = (max: number) =>
  z
    .string({ error: 'must be text' })
    .trim()
    .min(1, 'must not be empty')
    .max(max, `must be at most ${max} characters`)

/**
 * An object that refuses fields it does not know, saying so in plain words,
 * for example "gstin is not allowed here" when a seller tries to change their
 * GSTIN through the contacts form.
 */
export const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `${issue.keys.join(', ')} ${issue.keys.length === 1 ? 'is' : 'are'} not allowed here`
        : undefined,
  })

/** Plain-language messages for each problem, prefixed with the field name. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0
      ? `${issue.path.join('.')} ${issue.message}`
      : issue.message,
  )
}

/**
 * Checks `value` against `schema`, or throws a ValidationError that lists
 * every problem in plain words under `message`.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  message: string,
): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(message, describeIssues(result.error))
  }
  return result.data
}
