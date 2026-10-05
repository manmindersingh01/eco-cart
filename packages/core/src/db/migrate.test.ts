import { Client } from 'pg'
import { describe, expect, test } from 'vitest'
import { requireEnv } from '../env.ts'
import { TEST_WEB_PASSWORD, TEST_WORKER_PASSWORD } from '../testing/urls.ts'
import { migrateDatabase } from './migrate.ts'

async function currentUser(url: string): Promise<string> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query<{ user: string }>(
      'select current_user as user',
    )
    return rows[0]!.user
  } finally {
    await client.end()
  }
}

describe('migrateDatabase', () => {
  // The global setup already migrated this database once.
  test('changes nothing when run again', async () => {
    const messages: string[] = []
    await migrateDatabase({
      migrationUrl: requireEnv('MIGRATION_DATABASE_URL'),
      webPassword: TEST_WEB_PASSWORD,
      workerPassword: TEST_WORKER_PASSWORD,
      log: (message) => messages.push(message),
    })

    expect(messages).toEqual([
      'Database schema is up to date',
      'Database users ecokart_web and ecokart_worker can log in',
      expect.stringMatching(/^pg-boss schema "pgboss" is already at version/),
    ])
  })

  test('lets the web app and worker log in with their own users', async () => {
    expect(await currentUser(requireEnv('DATABASE_URL'))).toBe('ecokart_web')
    expect(await currentUser(requireEnv('WORKER_DATABASE_URL'))).toBe(
      'ecokart_worker',
    )
  })
})
