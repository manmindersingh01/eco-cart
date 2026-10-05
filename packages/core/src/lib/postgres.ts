/**
 * The constraint behind a PostgreSQL error with `code`, looking through
 * Drizzle's wrapping error, or null for any other error.
 */
function violatedConstraint(error: unknown, code: string): string | null {
  let current: unknown = error
  while (typeof current === 'object' && current !== null) {
    if (
      'code' in current &&
      current.code === code &&
      'constraint' in current &&
      typeof current.constraint === 'string'
    ) {
      return current.constraint
    }
    current = 'cause' in current ? current.cause : null
  }
  return null
}

/**
 * The constraint behind a unique-violation error (PostgreSQL code 23505).
 * Lets a service turn, for example, a taken invoice prefix into a clear
 * message even when two administrators race for it.
 */
export const uniqueViolation = (error: unknown): string | null =>
  violatedConstraint(error, '23505')

/**
 * The constraint behind a foreign-key error (PostgreSQL code 23503), for
 * example deleting a category that a product was just listed in.
 */
export const foreignKeyViolation = (error: unknown): string | null =>
  violatedConstraint(error, '23503')
