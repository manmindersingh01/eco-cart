import {
  createAppAuth,
  createDatabase,
  createPool,
  loadAuthConfig,
  loadNotificationConfig,
  requireEnv,
  startJobQueue,
} from '@ecokart/core'
import { PgBoss } from 'pg-boss'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { startWorker } from './worker.ts'

const options = () => ({
  databaseUrl: requireEnv('DATABASE_URL'),
  notifications: loadNotificationConfig(),
})

test('starts the job queue against the database and stops cleanly', async () => {
  const worker = await startWorker(options())
  try {
    expect(await worker.boss.isInstalled()).toBe(true)
  } finally {
    await worker.stop()
  }
})

test('says how to fix a database without the job queue tables', async () => {
  // The server's maintenance database has no pgboss schema.
  const url = new URL(requireEnv('DATABASE_URL'))
  url.pathname = '/postgres'
  await expect(
    startWorker({ ...options(), databaseUrl: url.href }),
  ).rejects.toThrow(
    'The job queue tables are missing or out of date. Run `pnpm db:migrate`',
  )
})

// The web app sends jobs as ecokart_web and the worker runs them as
// ecokart_worker; neither may create tables, so this proves their grants on
// the queue tables installed by `pnpm db:migrate` are enough.
test('runs a job sent by the web app’s database user', async () => {
  const queue = `test-round-trip-${crypto.randomUUID()}`
  const worker = await startWorker(options())
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
    await worker.boss.createQueue(queue)
    const received = new Promise<unknown>((resolve) => {
      void worker.boss.work(
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

const mailpitSearch = z.object({
  messages: z.array(z.object({ ID: z.string() })),
})
const mailpitMessage = z.object({ Text: z.string() })

/** Waits for the worker to deliver a message to `address` in Mailpit. */
async function waitForMail(address: string): Promise<string> {
  const mailpit = requireEnv('MAILPIT_URL')
  const query = new URLSearchParams({ query: `to:"${address}"` })
  for (let tries = 0; tries < 75; tries++) {
    const found = mailpitSearch.parse(
      await (
        await fetch(`${mailpit}/api/v1/search?${query.toString()}`)
      ).json(),
    )
    const id = found.messages[0]?.ID
    if (id) {
      return mailpitMessage.parse(
        await (await fetch(`${mailpit}/api/v1/message/${id}`)).json(),
      ).Text
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`No email reached ${address} within 15 seconds`)
}

test('a sign-in code travels from Better Auth through the worker to the inbox', async () => {
  const worker = await startWorker(options())
  const webUrl = requireEnv('WEB_DATABASE_URL')
  const pool = createPool(webUrl, 'worker-e2e-web')
  const queue = await startJobQueue(webUrl, 'worker-e2e-web-queue')
  const config = loadAuthConfig()
  const auth = createAppAuth({
    db: createDatabase(pool),
    getQueue: async () => queue,
    config,
  })
  const post = (path: string, body: object) =>
    auth.handler(
      new Request(`${config.baseURL}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: config.baseURL,
          'x-forwarded-for': '192.0.2.10',
        },
        body: JSON.stringify(body),
      }),
    )
  try {
    const email = `${crypto.randomUUID()}@example.test`
    const sent = await post('/email-otp/send-verification-otp', {
      email,
      type: 'sign-in',
    })
    expect(sent.status).toBe(200)

    const text = await waitForMail(email)
    const code = /Your EcoKart code is (\d{6})\./.exec(text)?.[1]
    expect(code).toMatch(/^\d{6}$/)

    const signedIn = await post('/sign-in/email-otp', { email, otp: code })
    expect(signedIn.status).toBe(200)
    expect(signedIn.headers.getSetCookie().join(';')).toContain(
      'ecokart.session_token=',
    )
  } finally {
    await queue.stop()
    await pool.end()
    await worker.stop()
  }
})
