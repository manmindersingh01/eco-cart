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
