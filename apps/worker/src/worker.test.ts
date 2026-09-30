import { requireEnv } from '@ecokart/core'
import { expect, test } from 'vitest'
import { startWorker } from './worker.ts'

test('starts the job queue against the database and stops cleanly', async () => {
  const boss = await startWorker(requireEnv('DATABASE_URL'))
  try {
    expect(await boss.isInstalled()).toBe(true)
  } finally {
    await boss.stop()
  }
})
