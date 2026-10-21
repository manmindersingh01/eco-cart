import { randomBytes, randomInt } from 'node:crypto'
import { parseArgs } from 'node:util'
import { crc32, deflateSync } from 'node:zlib'
import {
  createAppAuth,
  createDatabase,
  createPool,
  ensureAdministrator,
  formatRupees,
  loadAuthConfig,
  requireEnv,
} from '@ecokart/core'
import { createTestVideo, testPdf } from '@ecokart/core/testing'

/*
 * Walks the whole marketplace story through the real HTTP APIs of a running
 * web app and worker, the way the frontend will:
 *   pnpm demo:flow [--base-url http://localhost:3210] [--mailpit-url http://localhost:8025]
 * An administrator sets up a seller, the seller lists a product, a buyer
 * orders it with cash on delivery, the seller delivers it, and the buyer
 * downloads the invoice and reviews it. Every run uses new people and a new
 * product, so it can run again and again on the same local database. Sign-in
 * codes are read from Mailpit, so it only works against the local services.
 */

const { values } = parseArgs({
  options: {
    'base-url': {
      type: 'string',
      default: process.env.DEMO_BASE_URL ?? 'http://localhost:3210',
    },
    'mailpit-url': {
      type: 'string',
      default: process.env.MAILPIT_URL ?? 'http://localhost:8025',
    },
  },
})
const baseUrl = values['base-url'].replace(/\/$/, '')
const mailpitUrl = values['mailpit-url'].replace(/\/$/, '')

// One tag per run keeps every email, name, SKU, and title new.
const tag = randomBytes(3).toString('hex')
const word = `Ekdemo${Array.from({ length: 5 }, () => String.fromCodePoint(97 + randomInt(26))).join('')}`
const emails = {
  admin: `demo-admin-${tag}@ecokart.test`,
  seller: `demo-seller-${tag}@ecokart.test`,
  buyer: `demo-buyer-${tag}@example.test`,
}

/* ---------- Output ---------- */

const marks = { pass: '✓', fail: '✗', skip: '-' } as const
const counts = { pass: 0, fail: 0, skip: 0 }

function report(mark: keyof typeof marks, name: string, reason: string) {
  counts[mark] += 1
  console.info(`${marks[mark]} ${name}: ${reason}`)
}

/** A step that did not go as the story needs; the run stops there. */
class StepFailed extends Error {}

function fail(reason: string): never {
  throw new StepFailed(reason)
}

/** A step that finds the feature it shows is not there yet. */
class StepSkipped extends Error {}

function skip(reason: string): never {
  throw new StepSkipped(reason)
}

/* ---------- HTTP ---------- */

interface Answer {
  status: number
  body: unknown
  headers: Headers
}

/** A browser for one person: it keeps their cookies between requests. */
class Browser {
  readonly cookies = new Map<string, string>()

  async call(
    method: string,
    path: string,
    body?: unknown,
    options: { redirect?: 'manual' } = {},
  ): Promise<Answer> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      redirect: options.redirect ?? 'follow',
      headers: {
        origin: baseUrl,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookies.size > 0
          ? {
              cookie: [...this.cookies]
                .map(([name, value]) => `${name}=${value}`)
                .join('; '),
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = line.split(';')
      const [name = '', ...rest] = pair.split('=')
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))
      if (expired) this.cookies.delete(name.trim())
      else this.cookies.set(name.trim(), rest.join('='))
    }
    const raw = await response.text()
    let parsed: unknown = raw
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      // Not JSON, for example a redirect or a PDF.
    }
    return { status: response.status, body: parsed, headers: response.headers }
  }

  get = (path: string) => this.call('GET', path)
  post = (path: string, body: unknown = {}) => this.call('POST', path, body)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The objects in `value`, or none when it is not a list. */
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : []

/** The value at `path` in a JSON answer, such as `product.variants.0.id`. */
function pick(answer: Answer, path: string): unknown {
  let value: unknown = answer.body
  for (const part of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined
    value = isRecord(value) ? value[part] : undefined
  }
  return value
}

function text(answer: Answer, path: string): string {
  const value = pick(answer, path)
  if (typeof value !== 'string' && typeof value !== 'number') {
    fail(`the answer has no ${path}: ${describe(answer)}`)
  }
  return String(value)
}

function object(answer: Answer, path: string): Record<string, unknown> {
  const value = pick(answer, path)
  if (!isRecord(value)) fail(`the answer has no ${path}: ${describe(answer)}`)
  return value
}

function list(answer: Answer, path: string): Record<string, unknown>[] {
  const value = pick(answer, path)
  if (!Array.isArray(value)) fail(`the answer has no list ${path}`)
  return records(value)
}

/** A short account of an answer for a failure message. */
function describe(answer: Answer): string {
  const error = pick(answer, 'error')
  const issues = pick(answer, 'issues')
  if (typeof error === 'string') {
    return `${answer.status} ${error}${Array.isArray(issues) && issues.length > 0 ? ` (${issues.join('; ')})` : ''}`
  }
  return `${answer.status} ${JSON.stringify(answer.body).slice(0, 200)}`
}

function expectStatus(answer: Answer, status: number, what: string): Answer {
  if (answer.status !== status) {
    fail(`${what} answered ${describe(answer)}, expected ${status}`)
  }
  return answer
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Asks again every half second until `check` gives a value. */
async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined>,
  seconds = 90,
): Promise<T> {
  const until = Date.now() + seconds * 1000
  for (;;) {
    const found = await check()
    if (found !== undefined) return found
    if (Date.now() > until)
      fail(`gave up after ${seconds} seconds waiting for ${what}`)
    await sleep(500)
  }
}

/* ---------- Sign-in through Mailpit ---------- */

/** The messages of a Mailpit search for `email`, newest first. */
async function mailTo(email: string, limit: number) {
  const found: unknown = await (
    await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=${limit}`,
    )
  ).json()
  return records(isRecord(found) ? found.messages : undefined).map(
    (message) => ({
      id: String(message.ID),
      created: new Date(String(message.Created)).getTime(),
      subject: String(message.Subject),
    }),
  )
}

async function codeSentTo(email: string, since: number): Promise<string> {
  return waitFor(
    `the sign-in code for ${email}`,
    async () => {
      for (const message of await mailTo(email, 5)) {
        if (message.created < since) continue
        const full: unknown = await (
          await fetch(`${mailpitUrl}/api/v1/message/${message.id}`)
        ).json()
        const body = isRecord(full) ? String(full.Text) : ''
        const code = /\b(\d{6})\b/.exec(body)?.[1]
        if (code) return code
      }
      return undefined
    },
    30,
  )
}

/** The subject of the first email to `email` since `since` that matches. */
async function emailSentTo(
  email: string,
  since: number,
  subject: RegExp,
): Promise<string> {
  return waitFor(
    `an email to ${email} matching ${subject}`,
    async () => {
      return (await mailTo(email, 20)).find(
        (message) => message.created >= since && subject.test(message.subject),
      )?.subject
    },
    30,
  )
}

/**
 * Signs in with a code from Mailpit, the way a person types it in. A new
 * email becomes a buyer account. Waits out the one-minute limit on codes from
 * one address if an earlier run used it up.
 */
async function signIn(browser: Browser, email: string): Promise<string> {
  const since = Date.now() - 1000
  let sent = await browser.post('/api/auth/email-otp/send-verification-otp', {
    email,
    type: 'sign-in',
  })
  if (sent.status === 429) {
    const wait = Number(sent.headers.get('retry-after') ?? '60')
    console.info(
      `  (codes from this address are limited; waiting ${wait} seconds)`,
    )
    await sleep(wait * 1000)
    sent = await browser.post('/api/auth/email-otp/send-verification-otp', {
      email,
      type: 'sign-in',
    })
  }
  expectStatus(sent, 200, 'Asking for a sign-in code')
  const signedIn = await browser.post('/api/auth/sign-in/email-otp', {
    email,
    otp: await codeSentTo(email, since),
  })
  expectStatus(signedIn, 200, 'Signing in with the code')
  return text(await browser.get('/api/me'), 'role')
}

/* ---------- Files the people upload ---------- */

/** One PNG chunk: its length, type, data, and checksum. */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const check = Buffer.alloc(4)
  check.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, check])
}

/** An 800 by 800 PNG with a soft gradient, made without any image library. */
function demoPhoto(): Buffer {
  const side = 800
  const rows = Buffer.alloc((side * 3 + 1) * side)
  for (let y = 0; y < side; y += 1) {
    const start = y * (side * 3 + 1)
    for (let x = 0; x < side; x += 1) {
      const at = start + 1 + x * 3
      rows[at] = 40 + Math.round((x / side) * 120)
      rows[at + 1] = 120 + Math.round((y / side) * 100)
      rows[at + 2] = 90
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header.writeUInt8(8, 8) // bits per channel
  header.writeUInt8(2, 9) // red, green, blue
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Sends a file straight to object storage with a signed form, as a browser does. */
async function uploadWith(
  form: Answer,
  file: Buffer,
  contentType: string,
): Promise<string> {
  const url = text(form, 'upload.url')
  const fields = pick(form, 'upload.fields')
  if (!isRecord(fields)) fail('the upload form has no fields')
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    body.append(name, String(value))
  }
  body.append('file', new Blob([new Uint8Array(file)], { type: contentType }))
  const stored = await fetch(url, { method: 'POST', body })
  if (!stored.ok) fail(`object storage refused the upload: ${stored.status}`)
  return text(form, 'upload.key')
}

/* ---------- The story ---------- */

const admin = new Browser()
const seller = new Browser()
const buyer = new Browser()
const visitor = new Browser()

const story: Record<string, string> = {}

interface Step {
  name: string
  run?: () => Promise<string>
  /** Why the step cannot run yet. */
  skip?: string
}

const capitalLetter = () => String.fromCodePoint(65 + randomInt(26))

/** A buyer applies with the account that will also sell once approved. */
async function applyAsSeller(): Promise<string> {
  await signIn(seller, emails.seller)
  const pan = `DEMO${capitalLetter()}${String(randomInt(10_000)).padStart(4, '0')}${capitalLetter()}`
  const created = expectStatus(
    await seller.post('/api/account/seller-application', {
      displayName: `Demo Steelworks ${tag}`,
      legalName: `Demo Steelworks ${tag} Private Limited`,
      gstin: `27${pan}1Z5`,
      pan,
      line1: '12 MG Road',
      city: 'Pune',
      stateCode: '27',
      pincode: '411001',
      supportEmail: `support-${tag}@example.test`,
      supportPhone: '+919800000000',
      invoicePrefix: randomBytes(2).toString('hex').toUpperCase(),
    }),
    201,
    'Applying to sell',
  )
  story.sellerId = text(created, 'application.id')
  return `${text(created, 'application.displayName')} is ${text(created, 'application.status')}, owned by ${emails.seller}`
}

const steps: Step[] = [
  {
    name: 'The administrator signs in',
    async run() {
      // There is no sign-up for administrators: like `pnpm admin:create`.
      const pool = createPool(requireEnv('DATABASE_URL'), 'ecokart-demo-flow')
      try {
        const db = createDatabase(pool)
        const auth = createAppAuth({
          db,
          getQueue: async () => fail('creating an administrator sends nothing'),
          config: loadAuthConfig(),
        })
        await ensureAdministrator(auth, db, {
          email: emails.admin,
          name: 'Demo Administrator',
        })
      } finally {
        await pool.end()
      }
      const role = await signIn(admin, emails.admin)
      if (role !== 'admin') fail(`signed in as ${role}, not admin`)
      return `${emails.admin} signed in with the code from Mailpit`
    },
  },
  {
    name: 'The administrator makes sure there is a return window, a category with a GST rate, and a brand',
    async run() {
      // Only the client can decide the return window; `pnpm db:seed` saves
      // an example, and an administrator saves it on a database seeded before.
      const settings = expectStatus(
        await admin.get('/api/admin/settings'),
        200,
        'The platform settings',
      )
      const window = list(settings, 'settings').find(
        (setting) => setting.key === 'return_window_days',
      )
      let windowNote = `${String(window?.value)}-day return window`
      if (!window || window.source === 'missing') {
        expectStatus(
          await admin.call('PUT', '/api/admin/settings/return_window_days', {
            value: 7,
          }),
          200,
          'Saving the return window',
        )
        windowNote = 'return window was not set, so it is now 7 days'
      }

      const name = 'Demo Kitchenware'
      const tree = expectStatus(
        await admin.get('/api/admin/categories'),
        200,
        'The category tree',
      )
      const find = (
        nodes: Record<string, unknown>[],
      ): Record<string, unknown> | undefined => {
        for (const node of nodes) {
          if (node.name === name) return node
          const below = find(records(node.children))
          if (below) return below
        }
        return undefined
      }
      let category = find(list(tree, 'categories'))
      if (!category) {
        const created = expectStatus(
          await admin.post('/api/admin/categories', {
            name,
            gstRateBps: 1800,
            defaultHsnCode: '7323',
          }),
          201,
          'Creating the category',
        )
        category = object(created, 'category')
      }
      story.categoryId = String(category.id)
      story.categorySlug = String(category.slug)

      const brandName = 'Demo Greenware'
      const brands = expectStatus(
        await admin.get(`/api/admin/brands?q=${encodeURIComponent(brandName)}`),
        200,
        'The brand list',
      )
      let brand = list(brands, 'items').find((b) => b.name === brandName)
      if (!brand) {
        const created = expectStatus(
          await admin.post('/api/admin/brands', { name: brandName }),
          201,
          'Creating the brand',
        )
        brand = object(created, 'brand')
      }
      story.brandId = String(brand.id)
      return `${windowNote}; ${name} (GST ${Number(category.gstRateBps) / 100}%) and ${brandName} are ready`
    },
  },
  {
    name: 'A buyer applies to become a seller',
    run: applyAsSeller,
  },
  {
    name: 'The administrator asks for the seller’s GST certificate',
    async run() {
      const asked = expectStatus(
        await admin.post(`/api/admin/sellers/${story.sellerId}/documents`, {
          documents: [
            {
              type: 'gst_certificate',
              note: 'Please upload your GST certificate',
            },
          ],
        }),
        201,
        'Asking for a document',
      )
      story.documentId = text(asked, 'documents.0.id')
      const early = await admin.post(
        `/api/admin/sellers/${story.sellerId}/approve`,
      )
      if (early.status !== 409) {
        fail(
          `approval before the document was answered ${describe(early)}, expected 409`,
        )
      }
      return 'asked, and approval waits for the document'
    },
  },
  {
    name: 'The seller signs in and uploads the GST certificate',
    async run() {
      const role = text(await seller.get('/api/me'), 'role')
      if (role !== 'buyer')
        fail(`the pending applicant acts as ${role}, not buyer`)
      const pdf = testPdf()
      const form = expectStatus(
        await seller.post(`/api/seller/documents/${story.documentId}/uploads`, {
          contentType: 'application/pdf',
          size: pdf.length,
        }),
        201,
        'The document upload form',
      )
      const uploadKey = await uploadWith(form, pdf, 'application/pdf')
      expectStatus(
        await seller.post(`/api/seller/documents/${story.documentId}/files`, {
          uploadKey,
        }),
        202,
        'Adding the uploaded file',
      )
      await waitFor('the worker to check the file', async () => {
        const answer = await seller.get(
          `/api/seller/documents/${story.documentId}`,
        )
        const file = list(answer, 'document.files')[0]
        if (file?.status === 'failed') {
          fail(`the worker refused the file: ${String(file.failureReason)}`)
        }
        return pick(answer, 'document.status') === 'received' ? true : undefined
      })
      return 'the worker checked the PDF, and it waits for review'
    },
  },
  {
    name: 'The administrator accepts the document and approves the seller',
    async run() {
      expectStatus(
        await admin.post(
          `/api/admin/seller-documents/${story.documentId}/accept`,
        ),
        200,
        'Accepting the document',
      )
      const approved = expectStatus(
        await admin.post(`/api/admin/sellers/${story.sellerId}/approve`),
        200,
        'Approving the seller',
      )
      const status = text(approved, 'seller.status')
      if (status !== 'approved') fail(`the seller is ${status}`)
      return 'document accepted, seller approved'
    },
  },
  {
    name: 'The seller lists a product with variants, a minimum quantity, photos, and a video',
    async run() {
      const created = expectStatus(
        await seller.post('/api/seller/products', {
          categoryId: story.categoryId,
          brandId: story.brandId,
          title: `Steel Lunch Box ${word}`,
          description:
            'A leak-proof stainless steel lunch box with two compartments, made for school and office.',
          highlights: ['Food-grade stainless steel', 'Leak-proof lid'],
          optionNames: ['Size'],
          minOrderQuantity: 2,
          variants: [
            {
              sku: `LB-${tag}-750`,
              options: { Size: '750 ml' },
              pricePaise: 64_900,
              mrpPaise: 79_900,
              stock: 40,
            },
          ],
        }),
        201,
        'Creating the product',
      )
      story.productId = text(created, 'product.id')
      expectStatus(
        await seller.post(`/api/seller/products/${story.productId}/variants`, {
          sku: `LB-${tag}-1000`,
          options: { Size: '1 litre' },
          pricePaise: 74_900,
          mrpPaise: 89_900,
          stock: 25,
        }),
        201,
        'Adding a second variant',
      )

      for (let photo = 0; photo < 2; photo += 1) {
        const file = demoPhoto()
        const form = expectStatus(
          await seller.post(
            `/api/seller/products/${story.productId}/images/uploads`,
            {
              contentType: 'image/png',
              size: file.length,
            },
          ),
          201,
          'The photo upload form',
        )
        const uploadKey = await uploadWith(form, file, 'image/png')
        expectStatus(
          await seller.post(`/api/seller/products/${story.productId}/images`, {
            uploadKey,
          }),
          202,
          'Adding the photo',
        )
      }
      const video = await createTestVideo({
        width: 1280,
        height: 720,
        seconds: 2,
      })
      const videoForm = expectStatus(
        await seller.post(
          `/api/seller/products/${story.productId}/video/uploads`,
          {
            contentType: 'video/mp4',
            size: video.length,
          },
        ),
        201,
        'The video upload form',
      )
      const videoKey = await uploadWith(videoForm, video, 'video/mp4')
      expectStatus(
        await seller.post(`/api/seller/products/${story.productId}/video`, {
          uploadKey: videoKey,
        }),
        202,
        'Adding the video',
      )

      const ready = await waitFor(
        'the worker to process the photos and the video',
        async () => {
          const answer = await seller.get(
            `/api/seller/products/${story.productId}`,
          )
          const images = list(answer, 'product.images')
          const videoStatus = pick(answer, 'product.video.status')
          const failed = images.find((image) => image.status === 'failed')
          if (failed) fail(`a photo failed: ${String(failed.failureReason)}`)
          if (videoStatus === 'failed')
            fail(
              `the video failed: ${String(pick(answer, 'product.video.failureReason'))}`,
            )
          return images.length === 2 &&
            images.every((image) => image.status === 'ready') &&
            videoStatus === 'ready'
            ? answer
            : undefined
        },
        180,
      )
      story.variantId = text(ready, 'product.variants.0.id')
      return `2 variants, minimum 2, 2 photos and a video ready`
    },
  },
  {
    name: 'The seller submits the listing and the administrator approves it',
    async run() {
      expectStatus(
        await seller.post(`/api/seller/products/${story.productId}/submit`),
        200,
        'Submitting the listing',
      )
      // The administrator decides once the worker's screening has finished.
      const screened = await waitFor(
        'screening in the review queue',
        async () => {
          const queue = await admin.get('/api/admin/moderation?limit=100')
          const item = list(queue, 'items').find(
            (entry) =>
              isRecord(entry.product) && entry.product.id === story.productId,
          )
          return item && item.risk !== null ? item : undefined
        },
      )
      const approved = expectStatus(
        await admin.post(`/api/admin/products/${story.productId}/approve`),
        200,
        'Approving the listing',
      )
      story.productSlug = await waitFor(
        'the listing to be published',
        async () => {
          const answer = await seller.get(
            `/api/seller/products/${story.productId}`,
          )
          return pick(answer, 'product.status') === 'approved'
            ? text(answer, 'product.slug')
            : undefined
        },
      )
      const flags = records(screened.flags).map((flag) => String(flag.detail))
      return `screened as ${String(screened.risk)} risk${flags.length > 0 ? ` (${flags.join('; ')})` : ''}, approved (${approved.status}), live at /products/${story.productSlug}`
    },
  },
  {
    name: 'The seller imports more products from a CSV file',
    async run() {
      const headings = [
        'Product Name',
        'Category',
        'SKU',
        'Price (Rs)',
        'MRP (Rs)',
        'Stock',
        'Brand',
        'Min Qty',
      ]
      const rows = [
        [
          `Steel Water Bottle ${word}`,
          'Demo Kitchenware',
          `WB-${tag}`,
          '499',
          '599',
          '30',
          'Demo Greenware',
          '1',
        ],
        [
          `Steel Tiffin Carrier ${word}`,
          'Demo Kitchenware',
          `TC-${tag}`,
          '899',
          '1,099',
          '12',
          'Demo Greenware',
          '1',
        ],
        // No price, so this row is refused and listed in the error report.
        [
          `Copper Jug ${word}`,
          'Demo Kitchenware',
          `CJ-${tag}`,
          '',
          '999',
          '10',
          '',
          '1',
        ],
      ]
      const csv = Buffer.from(
        [headings, ...rows]
          .map((row) => row.join(',').replaceAll('1,099', '"1,099"'))
          .join('\n'),
      )
      const form = expectStatus(
        await seller.post('/api/seller/imports/uploads', {
          fileName: 'more-products.csv',
          size: csv.length,
        }),
        201,
        'The import upload form',
      )
      const fields = pick(form, 'upload.fields')
      const contentType =
        isRecord(fields) && typeof fields['Content-Type'] === 'string'
          ? fields['Content-Type']
          : 'text/csv'
      const uploadKey = await uploadWith(form, csv, contentType)
      const started = expectStatus(
        await seller.post('/api/seller/imports', {
          uploadKey,
          fileName: 'more-products.csv',
        }),
        202,
        'Starting the import',
      )
      const importId = text(started, 'import.id')
      const read = await waitFor('the worker to read the file', async () => {
        const answer = await seller.get(`/api/seller/imports/${importId}`)
        const status = pick(answer, 'import.status')
        if (status === 'failed')
          fail(`the import failed: ${String(pick(answer, 'import.error'))}`)
        return status === 'mapping_suggested' ? answer : undefined
      })
      // The seller accepts the suggested columns, as the mapping screen shows them.
      const suggested = object(read, 'import.suggestedMapping')
      const columnMapping = Object.fromEntries(
        Object.entries(suggested).flatMap(([heading, suggestion]) =>
          isRecord(suggestion) ? [[heading, String(suggestion.field)]] : [],
        ),
      )
      const unsettled = headings.filter(
        (heading) => !(heading in columnMapping),
      )
      expectStatus(
        await seller.call('PUT', `/api/seller/imports/${importId}/mapping`, {
          columnMapping,
        }),
        202,
        'Confirming the columns',
      )
      const done = await waitFor('the worker to make the drafts', async () => {
        const answer = await seller.get(`/api/seller/imports/${importId}`)
        const status = pick(answer, 'import.status')
        if (status === 'failed')
          fail(`the import failed: ${String(pick(answer, 'import.error'))}`)
        return status === 'completed' ? answer : undefined
      })
      const ok = Number(text(done, 'import.okRows'))
      const refused = Number(text(done, 'import.errorRows'))
      if (
        ok !== 2 ||
        refused !== 1 ||
        pick(done, 'import.hasErrorReport') !== true
      ) {
        fail(
          `expected 2 drafts and 1 refused row with a report, got ${ok} and ${refused}`,
        )
      }
      const drafts = expectStatus(
        await seller.get('/api/seller/products?status=draft&limit=100'),
        200,
        'The seller’s drafts',
      )
      const made = list(drafts, 'items').filter((item) =>
        String(item.title).endsWith(word),
      )
      return `the names matched ${headings.length - unsettled.length} of ${headings.length} columns${unsettled.length > 0 ? ` (not ${unsettled.join(', ')})` : ''}; ${made.length} drafts made, 1 row refused with an error report`
    },
  },
  {
    name: 'A buyer signs up with an email code',
    async run() {
      const role = await signIn(buyer, emails.buyer)
      if (role !== 'buyer') fail(`signed up as ${role}, not buyer`)
      expectStatus(
        await buyer.post('/api/auth/update-user', { name: 'Asha Verma' }),
        200,
        'Saving the buyer’s name',
      )
      return `${emails.buyer} is a new buyer`
    },
  },
  {
    name: 'The buyer browses the home page, the category, and a keyword search',
    async run() {
      expectStatus(await visitor.get('/api/home'), 200, 'The home page')
      await waitFor(
        'the product in its category',
        async () => {
          const page = await buyer.get(
            `/api/categories/${story.categorySlug}/products?limit=100`,
          )
          return list(page, 'items').some((item) => item.id === story.productId)
            ? true
            : undefined
        },
        30,
      )
      const found = expectStatus(
        await buyer.get(`/api/search?q=${encodeURIComponent(word)}`),
        200,
        'Keyword search',
      )
      const hits = list(found, 'items')
      if (!hits.some((item) => item.id === story.productId)) {
        fail(
          `searching for "${word}" did not find the product (${hits.length} results)`,
        )
      }
      const product = expectStatus(
        await buyer.get(`/api/products/${story.productSlug}`),
        200,
        'The product page',
      )
      return `found in ${story.categorySlug} and by searching "${word}"; the product page shows ${list(product, 'product.variants').length} variants`
    },
  },
  {
    name: 'The buyer asks the shopping assistant about the lunch box',
    async run() {
      const answer = await buyer.post('/api/assistant', {
        question: 'Will this lunch box keep dal from leaking?',
        history: [],
        productIds: [story.productId],
      })
      if (answer.status === 503) {
        skip(`the AI features are switched off here (${describe(answer)})`)
      }
      expectStatus(answer, 200, 'Asking the assistant')
      const cards = list(answer, 'products')
      return `${pick(answer, 'declined') === true ? 'declined' : 'answered'}, naming ${cards.length} product(s)`
    },
  },
  {
    name: 'The buyer adds to the cart: refused below the minimum, accepted at it',
    async run() {
      const below = await buyer.post('/api/cart/items', {
        variantId: story.variantId,
        quantity: 1,
      })
      if (below.status < 400 || below.status >= 500) {
        fail(`adding 1 answered ${describe(below)}, expected a refusal`)
      }
      const added = expectStatus(
        await buyer.post('/api/cart/items', {
          variantId: story.variantId,
          quantity: 2,
        }),
        200,
        'Adding 2',
      )
      story.totalPaise = text(added, 'cart.totalPaise')
      return `1 refused (${describe(below)}), 2 accepted; total ${formatRupees(Number(story.totalPaise))}`
    },
  },
  {
    name: 'The buyer adds an address and checks out with cash on delivery',
    async run() {
      const address = expectStatus(
        await buyer.post('/api/account/addresses', {
          fullName: 'Asha Verma',
          phone: '+919812345678',
          line1: '14 Lake Road',
          city: 'Bengaluru',
          stateCode: '29',
          pincode: '560001',
        }),
        201,
        'Saving the address',
      )
      const options = expectStatus(
        await buyer.get('/api/checkout'),
        200,
        'The ways to pay',
      )
      if (pick(options, 'cashOnDelivery') !== true)
        fail('cash on delivery is not offered')
      const since = Date.now() - 1000
      const placed = expectStatus(
        await buyer.post('/api/checkout', {
          addressId: text(address, 'address.id'),
          paymentMethod: 'cod',
          expectedTotalPaise: Number(story.totalPaise),
        }),
        201,
        'Placing the order',
      )
      story.orderId = text(placed, 'order.id')
      story.orderNumber = text(placed, 'order.orderNumber')
      const email = await emailSentTo(
        emails.buyer,
        since,
        new RegExp(story.orderNumber),
      )
      return `order ${story.orderNumber} is ${text(placed, 'order.status')}; the buyer got "${email}"`
    },
  },
  {
    name: 'The seller sees the order and dispatches it',
    async run() {
      const order = await waitFor(
        'the order in the seller’s to-dispatch tab',
        async () => {
          const tab = await seller.get(
            '/api/seller/orders?tab=to_dispatch&limit=100',
          )
          return list(tab, 'items').find((item) => item.id === story.orderId)
        },
        15,
      )
      const detail = expectStatus(
        await seller.get(`/api/seller/orders/${story.orderId}`),
        200,
        'The seller’s order',
      )
      const lineIds = list(detail, 'order.lines').map((line) => String(line.id))
      const since = Date.now() - 1000
      const dispatched = expectStatus(
        await seller.post(`/api/seller/orders/${story.orderId}/shipments`, {
          lineIds,
          courierName: 'Delhivery',
          trackingNumber: `DL${randomInt(10 ** 9, 10 ** 10)}`,
        }),
        201,
        'Dispatching',
      )
      story.shipmentId = text(dispatched, 'order.lines.0.shipment.id')
      const email = await emailSentTo(
        emails.buyer,
        since,
        /dispatch|shipped|on its way/i,
      )
      return `${String(order.orderNumber)} dispatched with Delhivery, ${lineIds.length} line(s); the buyer got "${email}"`
    },
  },
  {
    name: 'The parcel is marked delivered',
    async run() {
      const delivered = expectStatus(
        await seller.post(
          `/api/seller/shipments/${story.shipmentId}/delivered`,
        ),
        200,
        'Marking it delivered',
      )
      return `shipment is ${text(delivered, 'shipment.status')}`
    },
  },
  {
    name: 'The buyer sees the delivered order and downloads the invoice PDF',
    async run() {
      const order = expectStatus(
        await buyer.get(`/api/account/orders/${story.orderId}`),
        200,
        'The buyer’s order',
      )
      // Once every line is delivered, the order is complete.
      const status = text(order, 'order.status')
      story.lineId = text(order, 'order.lines.0.id')
      const lines = list(order, 'order.lines').map((line) => line.status)
      if (
        status !== 'completed' ||
        lines.some((line) => line !== 'delivered')
      ) {
        fail(`the order is ${status} with lines ${lines.join(', ')}`)
      }
      const invoices = expectStatus(
        await buyer.get(`/api/invoices?orderId=${story.orderId}`),
        200,
        'The order’s invoices',
      )
      const invoiceId = text(invoices, 'invoices.0.id')
      const link = await waitFor('the worker to make the PDF', async () => {
        const answer = await buyer.call(
          'GET',
          `/api/invoices/${invoiceId}/pdf`,
          undefined,
          {
            redirect: 'manual',
          },
        )
        if (answer.status === 409) return undefined
        if (answer.status !== 302)
          fail(`the PDF link answered ${describe(answer)}`)
        return (
          answer.headers.get('location') ?? fail('the PDF link has no address')
        )
      })
      const pdf = Buffer.from(await (await fetch(link)).arrayBuffer())
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-')
        fail('the download is not a PDF')
      return `order ${status} with every line delivered; invoice ${text(invoices, 'invoices.0.invoiceNumber')} downloaded, ${Math.round(pdf.length / 1024)} KB`
    },
  },
  {
    name: 'The buyer reviews the product',
    async run() {
      const review = expectStatus(
        await buyer.post(`/api/products/${story.productSlug}/reviews`, {
          rating: 5,
          authorName: 'Asha V.',
          title: 'Sturdy and truly leak-proof',
          body: 'Carried dal in it every day for a week without a single spill.',
        }),
        201,
        'Writing the review',
      )
      return `review is ${text(review, 'review.status')}`
    },
  },
  {
    name: 'The administrator sees the order, and no email in the story failed',
    async run() {
      const orders = expectStatus(
        await admin.get('/api/admin/orders?limit=100'),
        200,
        'The administrator’s order list',
      )
      if (!list(orders, 'items').some((order) => order.id === story.orderId)) {
        fail(`order ${story.orderNumber} is not in the administrator’s list`)
      }
      const failed = expectStatus(
        await admin.get('/api/admin/emails?limit=100'),
        200,
        'The failed and stuck emails',
      )
      const ours = list(failed, 'items').filter((email) =>
        Object.values(emails).includes(String(email.to)),
      )
      if (ours.length > 0) {
        fail(
          `emails did not go out: ${ours.map((email) => `${String(email.template)} to ${String(email.to)} (${String(email.lastError)})`).join('; ')}`,
        )
      }
      return `${story.orderNumber} is in the administrator’s list; every email went out`
    },
  },
  {
    name: 'The seller’s own login places an order as a buyer',
    async run() {
      // Another seller's product from the example data.
      const found = expectStatus(
        await seller.get('/api/search?q=toothbrush'),
        200,
        'Searching as the seller',
      )
      const slug = text(found, 'items.0.slug')
      const product = expectStatus(
        await seller.get(`/api/products/${slug}`),
        200,
        'The product page',
      )
      const added = await seller.post('/api/cart/items', {
        variantId: text(product, 'product.variants.0.id'),
      })
      expectStatus(added, 200, 'Adding to the cart')
      const address = expectStatus(
        await seller.post('/api/account/addresses', {
          fullName: 'Demo Seller Owner',
          phone: '+919800000000',
          line1: '12 MG Road',
          city: 'Pune',
          stateCode: '27',
          pincode: '411001',
        }),
        201,
        'Saving the seller’s delivery address',
      )
      const placed = expectStatus(
        await seller.post('/api/checkout', {
          addressId: text(address, 'address.id'),
          paymentMethod: 'cod',
          expectedTotalPaise: Number(text(added, 'cart.totalPaise')),
        }),
        201,
        'Placing the order',
      )
      return `${emails.seller} bought ${text(product, 'product.title')} as order ${text(placed, 'order.orderNumber')}`
    },
  },
  {
    name: 'The buyer asks to return one box, and the seller sees the request',
    async run() {
      const asked = expectStatus(
        await buyer.post('/api/account/returns', {
          orderItemId: story.lineId,
          quantity: 1,
          reasonCode: 'no_longer_needed',
          reasonText: 'Ordered one more than we need',
        }),
        201,
        'Asking for the return',
      )
      story.returnId = text(asked, 'return.id')
      const sellerView = expectStatus(
        await seller.get('/api/seller/returns?status=requested&limit=100'),
        200,
        'The seller’s returns',
      )
      if (
        !list(sellerView, 'items').some((item) => item.id === story.returnId)
      ) {
        fail('the return is not in the seller’s list')
      }
      return `return of 1 box is ${text(asked, 'return.status')}, and the seller sees it`
    },
  },
  {
    name: 'The administrator approves the return and records the refund',
    async run() {
      expectStatus(
        await admin.post(`/api/admin/returns/${story.returnId}/approve`, {
          note: 'Approved; the courier collects it this week',
        }),
        200,
        'Approving the return',
      )
      const approved = expectStatus(
        await admin.get(`/api/admin/returns/${story.returnId}`),
        200,
        'The approved return',
      )
      const amountPaise = Number(text(approved, 'return.maxRefundPaise'))
      // Cash on delivery is refunded by bank transfer, with its reference.
      expectStatus(
        await admin.post(`/api/admin/returns/${story.returnId}/refund`, {
          method: 'bank_transfer',
          amountPaise,
          note: `NEFT UTR ${randomInt(10 ** 9, 10 ** 10)}`,
        }),
        200,
        'Recording the refund',
      )
      const mine = expectStatus(
        await buyer.get(`/api/account/returns/${story.returnId}`),
        200,
        'The buyer’s return',
      )
      return `the buyer sees the return ${text(mine, 'return.status')} with ${formatRupees(amountPaise)} back`
    },
  },
  {
    name: 'The seller’s ledger shows the sale, the commission, and the return',
    async run() {
      const ledger = expectStatus(
        await seller.get('/api/seller/ledger?limit=100'),
        200,
        'The seller’s ledger',
      )
      const ofOrder = list(ledger, 'items').filter(
        (entry) => entry.orderId === story.orderId,
      )
      const amount = (type: string) =>
        ofOrder
          .filter((entry) => entry.entryType === type)
          .reduce((sum, entry) => sum + Number(entry.amountPaise), 0)
      const types = [
        'sale',
        'commission',
        'refund_reversal',
        'commission_reversal',
      ]
      const missing = types.filter(
        (type) => !ofOrder.some((entry) => entry.entryType === type),
      )
      if (missing.length > 0)
        fail(`the ledger has no ${missing.join(', ')} entry`)
      story.balancePaise = text(ledger, 'balancePaise')
      return `sale ${formatRupees(amount('sale'))}, commission ${formatRupees(amount('commission'))}, return ${formatRupees(amount('refund_reversal'))} with ${formatRupees(amount('commission_reversal'))} commission given back; balance ${formatRupees(Number(story.balancePaise))}`
    },
  },
  {
    name: 'The administrator pays the seller, and the seller’s statement shows it',
    async run() {
      expectStatus(
        await admin.call(
          'PUT',
          `/api/admin/sellers/${story.sellerId}/bank-account`,
          {
            accountHolder: `Demo Steelworks ${tag} Private Limited`,
            accountNumber: `50100${randomInt(10 ** 8, 10 ** 9)}`,
            ifsc: 'HDFC0001234',
          },
        ),
        200,
        'Saving the seller’s bank account',
      )
      const balances = expectStatus(
        await admin.get('/api/admin/seller-balances?limit=100'),
        200,
        'The sellers to pay',
      )
      const owed = list(balances, 'items').find(
        (item) => item.sellerId === story.sellerId,
      )
      if (!owed) fail('the seller is not in the list of sellers to pay')
      const amountPaise = Number(owed.balancePaise)
      const reference = `UTR${randomInt(10 ** 9, 10 ** 10)}`
      const paid = expectStatus(
        await admin.post(`/api/admin/sellers/${story.sellerId}/payouts`, {
          amountPaise,
          reference,
        }),
        201,
        'Recording the payout',
      )
      const after = Number(text(paid, 'balancePaise'))
      if (after !== 0)
        fail(`the balance after paying it all is ${formatRupees(after)}`)

      // The seller asks for today's statement, in India dates.
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
      }).format(new Date())
      const asked = expectStatus(
        await seller.post('/api/seller/settlement-statements', {
          from: today,
          to: today,
        }),
        202,
        'Asking for a statement',
      )
      const statementId = text(asked, 'statement.id')
      await waitFor('the worker to make the statement', async () => {
        const answer = await seller.get(
          `/api/settlement-statements/${statementId}?as=seller`,
        )
        const status = pick(answer, 'statement.status')
        if (status === 'failed') fail('the statement could not be made')
        return status === 'ready' ? true : undefined
      })
      const link = await seller.call(
        'GET',
        `/api/settlement-statements/${statementId}/file?as=seller`,
        undefined,
        { redirect: 'manual' },
      )
      if (link.status !== 302)
        fail(`the statement link answered ${describe(link)}`)
      const csv = await (await fetch(link.headers.get('location') ?? '')).text()
      if (!csv.includes(reference))
        fail('the statement does not show the payout')
      return `paid ${formatRupees(amountPaise)} with reference ${reference}, balance now ₹0; the seller’s statement for ${today} lists it (${csv.trim().split('\n').length} lines)`
    },
  },
]

console.info(`EcoKart demo flow against ${baseUrl} (run ${tag})\n`)
let stopped = false
for (const step of steps) {
  if (step.skip) {
    report('skip', step.name, step.skip)
    continue
  }
  if (stopped) {
    report('skip', step.name, 'not run: an earlier step failed')
    continue
  }
  try {
    report('pass', step.name, await step.run!())
  } catch (error) {
    if (error instanceof StepSkipped) {
      report('skip', step.name, error.message)
      continue
    }
    stopped = true
    report(
      'fail',
      step.name,
      error instanceof StepFailed
        ? error.message
        : `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
console.info(
  `\n${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`,
)
process.exitCode = counts.fail > 0 ? 1 : 0
