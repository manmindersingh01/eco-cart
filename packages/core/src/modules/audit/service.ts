import { isIP } from 'node:net'
import type { Transaction } from '../../db/client.ts'
import { auditLogs } from '../../db/schema/index.ts'

export type ActorRole = 'buyer' | 'seller' | 'admin' | 'system'

export interface AuditEntry {
  /** Null when the system acted, for example a command-line script. */
  actorUserId: string | null
  actorRole: ActorRole
  /** What happened, for example `user.set_role` or `seller.suspend`. */
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  ip?: string | null | undefined
}

/**
 * Records an administrator or system action (CLAUDE.md: every admin action
 * writes to audit_logs). Call it inside the transaction that makes the
 * change, so the entry exists exactly when the change does.
 */
export async function recordAuditEntry(
  tx: Transaction,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    // The inet column refuses anything that is not an address.
    ip: entry.ip && isIP(entry.ip) ? entry.ip : null,
  })
}
