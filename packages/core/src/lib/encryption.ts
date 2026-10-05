import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/*
 * Encrypts short secrets, such as a one-time code, that must wait in the
 * database until the worker sends them (backend spec step 2). Better Auth
 * stores its own copy of a code hashed; this keeps our queued copy unreadable
 * too, so a copy of the database alone never reveals a working code.
 *
 * Format: "v1.<iv>.<ciphertext and auth tag>", both base64url. The version
 * prefix leaves room to change the algorithm or rotate keys later.
 */

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

/** Reads a 32-byte key given in base64, as MESSAGE_ENCRYPTION_KEY is. */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64')
  if (key.length !== 32) {
    throw new Error(
      'MESSAGE_ENCRYPTION_KEY must be 32 random bytes in base64, for example from `openssl rand -base64 32`',
    )
  }
  return key
}

export function sealSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return `${VERSION}.${iv.toString('base64url')}.${ciphertext.toString('base64url')}`
}

/** Throws if the value was changed or sealed with another key. */
export function openSecret(sealed: string, key: Buffer): string {
  const [version, ivPart, dataPart, ...rest] = sealed.split('.')
  if (version !== VERSION || !ivPart || !dataPart || rest.length > 0) {
    throw new Error('Not a sealed secret')
  }
  const data = Buffer.from(dataPart, 'base64url')
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivPart, 'base64url'),
  )
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES))
  return Buffer.concat([
    decipher.update(data.subarray(0, data.length - TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8')
}
