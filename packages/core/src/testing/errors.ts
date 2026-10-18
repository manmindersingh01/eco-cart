import { ValidationError } from '../errors.ts'

/** The reasons a call was refused; fails the test if it was not. */
export async function validationIssues(
  attempt: Promise<unknown>,
): Promise<string[]> {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ValidationError)) {
    throw new Error(`Expected a ValidationError, got ${String(error)}`)
  }
  return error.issues
}

/**
 * The error a call failed with, checked to be a `kind`; fails the test if
 * the call succeeded or failed with another error.
 */
export async function rejectionOf<E extends Error>(
  attempt: Promise<unknown>,
  kind: new (...args: never[]) => E,
): Promise<E> {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof kind)) {
    throw new Error(`Expected a ${kind.name}, got ${String(error)}`)
  }
  return error
}
