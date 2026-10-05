import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import { emailOutbox } from '../db/schema/index.ts'
import { openSecret } from '../lib/encryption.ts'

/*
 * Reads sign-in codes back from where the worker picks them up, decrypted
 * as the worker would, so tests can sign in without a real inbox. `db` must
 * be the database owner, because only it can read the outbox and the queue.
 */

/** The newest code queued for `email`. */
export async function lastEmailedCode(
  db: Database,
  email: string,
  key: Buffer,
): Promise<string> {
  const [row] = await db
    .select({ payload: emailOutbox.payload })
    .from(emailOutbox)
    .where(eq(emailOutbox.toEmail, email))
    .orderBy(desc(emailOutbox.id))
    .limit(1)
  const { code } = z.object({ code: z.string() }).parse(row?.payload)
  return openSecret(code, key)
}

/** The newest code queued for an SMS to `phoneNumber`. */
export async function lastTextedCode(
  db: Database,
  phoneNumber: string,
  key: Buffer,
): Promise<string> {
  const result = await db.execute(
    sql`select data from pgboss.job where name = 'notifications.send-sms' and data->>'to' = ${phoneNumber} order by created_on desc limit 1`,
  )
  const { data } = z
    .object({ data: z.object({ code: z.string() }) })
    .parse(result.rows[0])
  return openSecret(data.code, key)
}
