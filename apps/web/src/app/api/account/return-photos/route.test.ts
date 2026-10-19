import {
  createDatabase,
  createObjectStorage,
  createPool,
  loadStorageConfig,
  requireEnv,
  schema,
} from '@ecokart/core'
import { checkUploadedReturnPhoto } from '@ecokart/core/worker'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { GET as openPhoto } from '@/app/api/return-photos/[id]/file/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET as readPhoto } from './[id]/route'
import { POST as uploadForm } from './uploads/route'
import { POST as addPhoto } from './route'

/*
 * Return photos through the API (design doc 5.7): the buyer's browser posts
 * the photo straight to object storage, and the worker's check runs
 * (called directly).
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'return-photos-route-test',
)
const owner = createDatabase(ownerPool)
const storage = createObjectStorage(loadStorageConfig())

let buyerCookie: string
let otherBuyerCookie: string

async function signedInBuyer() {
  const email = `${crypto.randomUUID()}@example.test`
  const cookie = await signInWithEmail(owner, email)
  const [user] = await owner
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
  return { cookie, id: user!.id }
}

beforeAll(async () => {
  const [buyer, otherBuyer] = await Promise.all([
    signedInBuyer(),
    signedInBuyer(),
  ])
  buyerCookie = buyer.cookie
  otherBuyerCookie = otherBuyer.cookie
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const photoView = z.object({
  photo: z
    .object({
      id: z.string(),
      status: z.string(),
      failureReason: z.string().nullable(),
    })
    .loose(),
})

describe('return photos', () => {
  test('the buyer uploads a photo, the worker checks it, and the buyer opens it', async () => {
    const asked = await uploadForm(
      request('/account/return-photos/uploads', {
        method: 'POST',
        cookie: buyerCookie,
        body: { contentType: 'image/jpeg', size: 200_000 },
      }),
    )
    expect(asked.status).toBe(201)
    const { upload } = z
      .object({
        upload: z.object({
          key: z.string(),
          url: z.string(),
          fields: z.record(z.string(), z.string()),
        }),
      })
      .parse(await asked.json())

    const body = new FormData()
    for (const [name, value] of Object.entries(upload.fields)) {
      body.append(name, value)
    }
    const photo = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#80603a' },
    })
      .jpeg()
      .toBuffer()
    body.append('file', new Blob([new Uint8Array(photo)]))
    expect((await fetch(upload.url, { method: 'POST', body })).status).toBe(204)

    const added = await addPhoto(
      request('/account/return-photos', {
        method: 'POST',
        cookie: buyerCookie,
        body: { uploadKey: upload.key },
      }),
    )
    expect(added.status).toBe(202)
    const { photo: processing } = photoView.parse(await added.json())
    expect(processing.status).toBe('processing')

    const tooEarly = await openPhoto(
      request(`/return-photos/${processing.id}/file`, { cookie: buyerCookie }),
      withId(processing.id),
    )
    expect(tooEarly.status).toBe(409)

    await checkUploadedReturnPhoto({ db: owner, storage }, processing.id)
    const read = await readPhoto(
      request(`/account/return-photos/${processing.id}`, {
        cookie: buyerCookie,
      }),
      withId(processing.id),
    )
    expect(photoView.parse(await read.json()).photo.status).toBe('ready')

    const redirect = await openPhoto(
      request(`/return-photos/${processing.id}/file`, { cookie: buyerCookie }),
      withId(processing.id),
    )
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('cache-control')).toBe('no-store')
    const file = await fetch(redirect.headers.get('location')!)
    expect(file.status).toBe(200)

    for (const cookie of [otherBuyerCookie, undefined]) {
      const refused = await openPhoto(
        request(
          `/return-photos/${processing.id}/file`,
          cookie ? { cookie } : {},
        ),
        withId(processing.id),
      )
      expect(refused.status).toBe(cookie ? 404 : 401)
    }
  })

  test('answers bad input with plain messages', async () => {
    const response = await uploadForm(
      request('/account/return-photos/uploads', {
        method: 'POST',
        cookie: buyerCookie,
        body: { contentType: 'image/gif', size: 0 },
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'That photo cannot be uploaded',
      issues: [
        'contentType must be image/jpeg, image/png, image/webp, or image/avif',
        'size must be at least 1 byte',
      ],
    })
  })
})
