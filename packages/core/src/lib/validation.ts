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

/**
 * A message for a value of the wrong type that still lets a missing value
 * read "is required" (see plainErrors).
 */
const unlessMissing =
  (message: string) =>
  (issue: { input?: unknown }): string | undefined =>
    issue.input === undefined ? undefined : message

/** The id of a row, for example `parentId`; `what` names it in the message. */
export const idOf = (what: string) =>
  z
    .string({ error: unlessMissing(`must be ${what} id`) })
    .refine(isUuid, `must be ${what} id`)

/** An email address. */
export const email = z.email({
  error: unlessMissing('must be an email address'),
})

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

/**
 * The GST rates in force since GST 2.0 (22 September 2025), in basis points:
 * 0%, 0.25% (rough diamonds), 3% (gold and silver), 5%, 18%, and 40%. A rate
 * outside this list is almost always one copied from an old rate sheet, such
 * as the 12% and 28% that GST 2.0 removed. Orders keep whatever rate they
 * were placed with, so this list only guards new catalogue data.
 */
export const GST_RATES_BPS: readonly number[] = [0, 25, 300, 500, 1800, 4000]

const asPercent = (bps: number) => `${bps / 100}%`

export const gstRateBps = z
  .number()
  .refine(
    (value) => GST_RATES_BPS.includes(value),
    `must be one of the current GST rates in basis points: ${GST_RATES_BPS.map(
      (bps) => `${bps} (${asPercent(bps)})`,
    ).join(', ')}`,
  )

/** HSN codes on GST invoices have 4, 6, or 8 digits. */
export const hsnCode = z
  .string()
  .regex(
    /^(\d{4}|\d{6}|\d{8})$/,
    'must be an HSN code of 4, 6, or 8 digits, like 4419',
  )

/** A web address name, like kitchen-and-dining (see lib/slug.ts). */
export const slug = z
  .string()
  .max(60, 'must be at most 60 characters')
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'must be lowercase letters and digits joined by single hyphens, like kitchen-and-dining',
  )

/** A whole number within limits, with messages an administrator can read. */
export const wholeNumber = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .number()
    .int('must be a whole number')
    .min(min, `must be at least ${min}`)
    .max(max, `must be at most ${max}`)

/** A whole number of paise that JavaScript holds exactly. */
export const paise = wholeNumber(0)

/** Trimmed text that is not empty and not longer than `max` characters. */
export const text = (max: number) =>
  z
    .string()
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

const TYPE_WORDS: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  object: 'an object',
  record: 'an object',
  array: 'a list',
}

/**
 * Plain words for a value that is missing, of the wrong type, or not one of
 * the allowed choices, for every schema without a message of its own: "is
 * required", "must be text", "must be one of home, office". Without it the validation library's own wording ("Invalid
 * input: expected string, received undefined") would reach people.
 */
export const plainErrors: z.core.$ZodErrorMap = (issue) => {
  if (issue.input === undefined) return 'is required'
  if (issue.code === 'invalid_value') {
    return `must be one of ${issue.values.map(String).join(', ')}`
  }
  if (issue.code !== 'invalid_type') return undefined
  const expected = TYPE_WORDS[issue.expected]
  return expected ? `must be ${expected}` : undefined
}

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
  const result = schema.safeParse(value, { error: plainErrors })
  if (!result.success) {
    throw new ValidationError(message, describeIssues(result.error))
  }
  return result.data
}
