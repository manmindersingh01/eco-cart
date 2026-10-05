/**
 * The constraint behind a unique-violation error (PostgreSQL code 23505),
 * looking through Drizzle's wrapping error, or null for any other error.
 * Lets a service turn, for example, a taken invoice prefix into a clear
 * message even when two administrators race for it.
 */
export function uniqueViolation(error: unknown): string | null {
  let current: unknown = error
  while (typeof current === 'object' && current !== null) {
    if (
      'code' in current &&
      current.code === '23505' &&
      'constraint' in current &&
      typeof current.constraint === 'string'
    ) {
      return current.constraint
    }
    current = 'cause' in current ? current.cause : null
  }
  return null
}
