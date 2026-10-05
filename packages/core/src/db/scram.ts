import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'

// PostgreSQL's default scram_iterations.
const ITERATIONS = 4096

/**
 * Hashes a password the way PostgreSQL stores it (SCRAM-SHA-256, RFC 5802),
 * so `ALTER ROLE ... PASSWORD` receives the hash and the plain password never
 * appears in a statement the server could log.
 *
 * Only printable ASCII passwords are accepted. PostgreSQL normalises other
 * characters with SASLprep, and refusing them here avoids a hash that does
 * not match what the server expects at login.
 */
export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(16),
): string {
  if (!/^[\x21-\x7e]+$/.test(password)) {
    throw new Error('Database passwords must be printable ASCII without spaces')
  }
  const saltedPassword = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  const clientKey = createHmac('sha256', saltedPassword)
    .update('Client Key')
    .digest()
  const storedKey = createHash('sha256').update(clientKey).digest()
  const serverKey = createHmac('sha256', saltedPassword)
    .update('Server Key')
    .digest()
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}
