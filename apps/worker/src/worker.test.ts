import { requireEnv } from '@ecokart/core'
import { PgBoss } from 'pg-boss'
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

test('says how to fix a database without the job queue tables', async () => {
  // The server's maintenance database has no pgboss schema.
  const url = new URL(requireEnv('DATABASE_URL'))
  url.pathname = '/postgres'
  await expect(startWorker(url.href)).rejects.toThrow(
    'The job queue tables are missing or out of date. Run `pnpm db:migrate`',
  )
})

// The web app sends jobs as ecokart_web and the worker runs them as
// ecokart_worker; neither may create tables, so this proves their grants on
// the queue tables installed by `pnpm db:migrate` are enough.
test('runs a job sent by the web app’s database user', async () => {
  const queue = `test-round-trip-${crypto.randomUUID()}`
  const worker = await startWorker(requireEnv('DATABASE_URL'))
  const web = new PgBoss({
    connectionString: requireEnv('WEB_DATABASE_URL'),
    migrate: false,
    supervise: false,
    schedule: false,
  })
  const webErrors: unknown[] = []
  web.on('error', (error) => webErrors.push(error))
  await web.start()
  try {
    await worker.createQueue(queue)
    const received = new Promise<unknown>((resolve) => {
      void worker.work(
        queue,
        { pollingIntervalSeconds: 0.5 },
        async ([job]) => {
          resolve(job?.data)
        },
      )
    })
    await web.send(queue, { orderNumber: 'EK-261005-000001' })

    expect(await received).toEqual({ orderNumber: 'EK-261005-000001' })
    expect(webErrors).toEqual([])
  } finally {
    await web.stop()
    await worker.stop()
  }
})
