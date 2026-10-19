import { z } from 'zod'
import { encryptionKey, parseEnv } from '../../lib/config.ts'

/**
 * Settings for seller money (design doc 5.9): the key that seals sellers'
 * bank account numbers, the same MESSAGE_ENCRYPTION_KEY that seals waiting
 * sign-in codes.
 */
export function loadLedgerConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = parseEnv(
    z.object({ MESSAGE_ENCRYPTION_KEY: encryptionKey(env) }),
    env,
  )
  return { encryptionKey: config.MESSAGE_ENCRYPTION_KEY }
}

export type LedgerConfig = ReturnType<typeof loadLedgerConfig>
