import { loadLedgerConfig, type LedgerConfig } from '@ecokart/core'

const globalForLedger = globalThis as typeof globalThis & {
  ecokartLedger?: LedgerConfig
}

/** The key that seals sellers' bank account numbers. */
export function getSealingKey(): Buffer {
  globalForLedger.ecokartLedger ??= loadLedgerConfig()
  return globalForLedger.ecokartLedger.encryptionKey
}
