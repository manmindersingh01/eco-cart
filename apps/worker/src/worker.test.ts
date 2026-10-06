import {
  addImage,
  createAppAuth,
  createDatabase,
  createImageUpload,
  createObjectStorage,
  createPool,
  createProduct,
  getOwnProduct,
  loadAuthConfig,
  loadNotificationConfig,
  loadStorageConfig,
  QUEUES,
  requireEnv,
  startJobQueue,
  withContext,
} from '@ecokart/core'
import {
  createTestCategory,
  createTestSeller,
  waitUntil,
} from '@ecokart/core/testing'
import { PgBoss } from 'pg-boss'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { startWorker } from './worker.ts'

const options = () => ({
  databaseUrl: requireEnv('DATABASE_URL'),
  notifications: loadNotificationConfig(),
  storage: loadStorageConfig(),
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

test('refuses to start while a job queue is missing', async () => {
  const [queue] = QUEUES.slice(-1)
  const admin = new PgBoss({
    connectionString: requireEnv('MIGRATION_DATABASE_URL'),
    migrate: false,
    supervise: false,
    schedule: false,
  })
  await admin.start()
  try {
    await admin.deleteQueue(queue!.name)
    await expect(startWorker(options())).rejects.toThrow(
      `The job queues ${queue!.name} are missing. Run \`pnpm db:migrate\`, then start the worker again.`,
    )
  } finally {
    await admin.createQueue(queue!.name, queue!.options)
    await admin.stop()
  }
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

test('a photo travels from the browser upload through the worker to its public sizes', async () => {
  const worker = await startWorker(options())
  const webUrl = requireEnv('WEB_DATABASE_URL')
  const webPool = createPool(webUrl, 'worker-e2e-photo-web')
  const ownerPool = createPool(
    requireEnv('MIGRATION_DATABASE_URL'),
    'worker-e2e-photo-owner',
  )
  const queue = await startJobQueue(webUrl, 'worker-e2e-photo-queue')
  const web = createDatabase(webPool)
  const owner = createDatabase(ownerPool)
  const storage = createObjectStorage(loadStorageConfig())
  try {
    const { owner: user, seller: business } = await createTestSeller(owner)
    const seller = {
      role: 'seller' as const,
      userId: user.id,
      sellerId: business.id,
    }
    const category = await createTestCategory(owner)
    const product = await withContext(web, seller, (tx) =>
      createProduct(tx, storage, seller, {
        categoryId: category.id,
        title: 'Terracotta Water Bottle',
        variants: [
          { sku: 'TWB-1', pricePaise: 59_900, mrpPaise: 69_900, stock: 12 },
        ],
      }),
    )

    // The browser asks for a form and posts the photo straight to storage.
    const form = await createImageUpload(
      { db: web, storage },
      seller,
      product.id,
      {
        contentType: 'image/png',
        size: 50_000,
      },
    )
    const body = new FormData()
    for (const [name, value] of Object.entries(form.fields)) {
      body.append(name, value)
    }
    const photo = await sharp({
      create: { width: 900, height: 900, channels: 3, background: '#b5532e' },
    })
      .png()
      .toBuffer()
    body.append('file', new Blob([photo]))
    expect((await fetch(form.url, { method: 'POST', body })).status).toBe(204)

    await withContext(web, seller, (tx) =>
      addImage(tx, storage, queue, seller, product.id, { uploadKey: form.key }),
    )
    const current = () =>
      withContext(web, seller, (tx) =>
        getOwnProduct(tx, storage, seller, product.id),
      )
    await waitUntil(
      async () => (await current()).images[0]?.status === 'ready',
      15_000,
    )

    const card = await fetch((await current()).images[0]!.urls!.card)
    expect(card.status).toBe(200)
    const size = await sharp(Buffer.from(await card.arrayBuffer())).metadata()
    expect([size.format, size.width, size.height]).toEqual(['webp', 480, 480])
  } finally {
    await queue.stop()
    await Promise.all([webPool.end(), ownerPool.end()])
    await worker.stop()
  }
  // The worker picks jobs up every two seconds, so allow for a slow runner.
}, 30_000)
