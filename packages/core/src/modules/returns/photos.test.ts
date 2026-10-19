import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { returnPhotos } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotSignedInError,
  TooManyRequestsError,
} from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '../../lib/storage.ts'
import { rejectionOf, validationIssues } from '../../testing/errors.ts'
import {
  createTestReturnRequest,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { checkUploadedReturnPhoto } from './jobs.ts'
import {
  addReturnPhoto,
  attachReturnPhotos,
  CHECK_RETURN_PHOTO_QUEUE,
  createReturnPhotoUpload,
  getReturnPhoto,
  getReturnPhotoDownload,
} from './photos.ts'
import type { ReturnPhotoView } from './types.ts'

/*
 * Buyers' return photos (design doc 5.7) against the real database, job
 * queue, and object storage.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'return-photos-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const deps = { db: worker, storage }
let queue: JobQueue

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'return-photos-test')
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

type Buyer = Extract<RequestContext, { role: 'buyer' }>

async function newBuyer(): Promise<Buyer> {
  return { role: 'buyer', userId: (await createTestUser(owner, 'buyer')).id }
}

/** A phone photo of a damaged item, with EXIF data. */
const phonePhoto = () =>
  sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#6b4f2a' },
  })
    .withExif({ IFD0: { Make: 'PhoneCo', Model: 'P1' } })
    .jpeg()
    .toBuffer()

/**
 * What the buyer's browser does: asks for a form, posts the photo to it,
 * and adds the upload. The post is stood in for by a direct write.
 */
async function upload(
  buyer: Buyer,
  bytes: Buffer | null,
): Promise<ReturnPhotoView & { uploadKey: string }> {
  const form = await createReturnPhotoUpload({ db: web, storage }, buyer, {
    contentType: 'image/jpeg',
    size: bytes?.length ?? 100,
  })
  if (bytes) await storage.write(form.key, bytes, { contentType: 'image/jpeg' })
  const photo = await withContext(web, buyer, (tx) =>
    addReturnPhoto(tx, queue, buyer, { uploadKey: form.key }),
  )
  return { ...photo, uploadKey: form.key }
}

async function readyPhoto(buyer: Buyer): Promise<string> {
  const { id } = await upload(buyer, await phonePhoto())
  await checkUploadedReturnPhoto(deps, id)
  return id
}

const read = (buyer: Buyer, id: string) =>
  withContext(web, buyer, (tx) => getReturnPhoto(tx, buyer, id))

const attach = (buyer: Buyer, returnRequestId: string, photoIds: unknown) =>
  withContext(web, buyer, (tx) =>
    attachReturnPhotos(tx, buyer, returnRequestId, photoIds),
  )

describe('uploading a return photo', () => {
  test('signs a private upload form for the buyer', async () => {
    const buyer = await newBuyer()
    const form = await createReturnPhotoUpload({ db: web, storage }, buyer, {
      contentType: 'image/png',
      size: 2_000_000,
    })
    expect(form.key).toMatch(
      new RegExp(`^uploads/returns/${buyer.userId}/[0-9a-f-]{36}$`),
    )
    expect(form.fields['Content-Type']).toBe('image/png')
    expect(form.maxBytes).toBe(10 * 1024 * 1024)
  })

  test('takes photos up to 10 MB, from buyers only', async () => {
    const buyer = await newBuyer()
    expect(
      await validationIssues(
        createReturnPhotoUpload({ db: web, storage }, buyer, {
          contentType: 'application/pdf',
          size: 11 * 1024 * 1024,
        }),
      ),
    ).toEqual([
      'contentType must be image/jpeg, image/png, image/webp, or image/avif',
      'size must be at most 10 MB',
    ])
    const input = { contentType: 'image/jpeg', size: 100 }
    const { owner: user, seller } = await createTestSeller(owner)
    await expect(
      createReturnPhotoUpload(
        { db: web, storage },
        { role: 'seller', userId: user.id, sellerId: seller.id },
        input,
      ),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      createReturnPhotoUpload(
        { db: web, storage },
        { role: 'anonymous' },
        input,
      ),
    ).rejects.toThrow(NotSignedInError)
  })

  test('adds the upload as processing and queues its check', async () => {
    const buyer = await newBuyer()
    const photo = await upload(buyer, await phonePhoto())
    expect(photo).toMatchObject({
      status: 'processing',
      failureReason: null,
      returnRequestId: null,
    })
    const jobs = await owner.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${CHECK_RETURN_PHOTO_QUEUE} and data->>'photoId' = ${photo.id}`,
    )
    expect(jobs.rows[0]!.count).toBe(1)
  })

  test('refuses another buyer’s upload key, or the same key twice', async () => {
    const buyer = await newBuyer()
    const other = await newBuyer()
    const form = await createReturnPhotoUpload({ db: web, storage }, other, {
      contentType: 'image/jpeg',
      size: 100,
    })
    const add = (uploadKey: string) =>
      withContext(web, buyer, (tx) =>
        addReturnPhoto(tx, queue, buyer, { uploadKey }),
      )
    expect(await validationIssues(add(form.key))).toEqual([
      'uploadKey is not an upload of yours',
    ])
    const own = await upload(buyer, null)
    expect(await validationIssues(add(own.uploadKey))).toEqual([
      'uploadKey was already added',
    ])
  })

  test('allows 20 waiting photos a day', async () => {
    const buyer = await newBuyer()
    await owner.insert(returnPhotos).values(
      Array.from({ length: 20 }, () => ({
        userId: buyer.userId,
        uploadKey: `uploads/returns/${buyer.userId}/${crypto.randomUUID()}`,
      })),
    )
    const error = await rejectionOf(
      createReturnPhotoUpload({ db: web, storage }, buyer, {
        contentType: 'image/jpeg',
        size: 100,
      }),
      TooManyRequestsError,
    )
    expect(error.message).toBe(
      'You can upload at most 20 return photos a day; send your return with the photos you have',
    )
    // Failed photos do not count.
    await owner
      .update(returnPhotos)
      .set({ status: 'failed', failureReason: 'The file is damaged' })
      .where(eq(returnPhotos.userId, buyer.userId))
    await createReturnPhotoUpload({ db: web, storage }, buyer, {
      contentType: 'image/jpeg',
      size: 100,
    })
  })
})

describe('the worker’s check', () => {
  test('keeps a re-encoded private copy and removes the upload', async () => {
    const buyer = await newBuyer()
    const photo = await upload(buyer, await phonePhoto())
    await checkUploadedReturnPhoto(deps, photo.id)
    expect(await read(buyer, photo.id)).toMatchObject({
      status: 'ready',
      width: 1600,
      height: 1200,
      failureReason: null,
    })
    const stored = await storage.read(`returns/${photo.id}`)
    const metadata = await sharp(stored!).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(metadata.exif).toBeUndefined()
    expect(await storage.read(photo.uploadKey)).toBeNull()
    expect((await fetch(storage.publicUrl(`returns/${photo.id}`))).status).toBe(
      403,
    )
    // A second run changes nothing.
    await checkUploadedReturnPhoto(deps, photo.id)
    expect((await read(buyer, photo.id)).status).toBe('ready')
  })

  test('a file that is not a photo fails with the reason', async () => {
    const buyer = await newBuyer()
    const photo = await upload(buyer, Buffer.from('%PDF-1.7 a receipt'))
    await checkUploadedReturnPhoto(deps, photo.id)
    expect(await read(buyer, photo.id)).toMatchObject({
      status: 'failed',
      failureReason: 'The file is not a JPEG, PNG, WebP, or AVIF image',
    })
    expect(await storage.read(photo.uploadKey)).toBeNull()
  })

  test('says so when the upload never arrived', async () => {
    const buyer = await newBuyer()
    const photo = await upload(buyer, null)
    await checkUploadedReturnPhoto(deps, photo.id)
    expect((await read(buyer, photo.id)).failureReason).toBe(
      'The upload did not arrive; add the photo again',
    )
  })

  test('retries when storage fails, and gives up plainly on the last try', async () => {
    const buyer = await newBuyer()
    const photo = await upload(buyer, await phonePhoto())
    const failing: ObjectStorage = {
      ...storage,
      write: () => Promise.reject(new Error('Storage is unavailable')),
    }
    await expect(
      checkUploadedReturnPhoto({ db: worker, storage: failing }, photo.id, {
        lastAttempt: false,
      }),
    ).rejects.toThrow('Storage is unavailable')
    expect((await read(buyer, photo.id)).status).toBe('processing')
    await checkUploadedReturnPhoto({ db: worker, storage: failing }, photo.id)
    expect((await read(buyer, photo.id)).failureReason).toBe(
      'The photo could not be checked; add it again',
    )
  })

  test('a buyer reads only their own photo', async () => {
    const buyer = await newBuyer()
    const photo = await upload(buyer, null)
    await expect(read(await newBuyer(), photo.id)).rejects.toThrow(
      NotFoundError,
    )
    await expect(read(buyer, 'not-an-id')).rejects.toThrow(NotFoundError)
  })
})

describe('sending photos with a return', () => {
  test('attaches ready photos and gives their storage keys in order', async () => {
    const buyer = await newBuyer()
    const { seller } = await createTestSeller(owner)
    const { returnRequest } = await createTestReturnRequest(owner, {
      buyerId: buyer.userId,
      sellerId: seller.id,
    })
    const first = await readyPhoto(buyer)
    const second = await readyPhoto(buyer)
    const keys = await attach(buyer, returnRequest.id, [second, first])
    expect(keys).toEqual([`returns/${second}`, `returns/${first}`])
    expect((await read(buyer, first)).returnRequestId).toBe(returnRequest.id)
    expect(await attach(buyer, returnRequest.id, [])).toEqual([])
  })

  test('refuses photos that are not ready, not the buyer’s, or already sent', async () => {
    const buyer = await newBuyer()
    const { seller } = await createTestSeller(owner)
    const { returnRequest } = await createTestReturnRequest(owner, {
      buyerId: buyer.userId,
      sellerId: seller.id,
    })
    const { returnRequest: secondReturn } = await createTestReturnRequest(
      owner,
      { buyerId: buyer.userId, sellerId: seller.id },
    )
    const sent = await readyPhoto(buyer)
    await attach(buyer, returnRequest.id, [sent])
    const failed = await upload(buyer, Buffer.from('not a photo'))
    await checkUploadedReturnPhoto(deps, failed.id)
    const others = await readyPhoto(await newBuyer())

    expect(
      await validationIssues(
        attach(buyer, secondReturn.id, [sent, failed.id, others]),
      ),
    ).toEqual([
      `photo ${sent} was already sent with a return`,
      `photo ${failed.id} failed the check: The file is not a JPEG, PNG, WebP, or AVIF image`,
      `photo ${others} is not one of your photos`,
    ])
    expect(
      await validationIssues(attach(buyer, secondReturn.id, [sent, sent])),
    ).toEqual(['photoIds lists a photo more than once'])
    const six = Array.from({ length: 6 }, () => crypto.randomUUID())
    expect(await validationIssues(attach(buyer, secondReturn.id, six))).toEqual(
      ['must list at most 5 photos'],
    )

    const waiting = await upload(buyer, await phonePhoto())
    const error = await rejectionOf(
      attach(buyer, secondReturn.id, [waiting.id]),
      ConflictError,
    )
    expect(error.message).toBe(
      'A photo is still being checked; wait a moment and send the return again',
    )
    // Nothing was attached by the refused calls.
    expect((await read(buyer, waiting.id)).returnRequestId).toBeNull()
  })

  test('only to the buyer’s own return', async () => {
    const buyer = await newBuyer()
    const other = await newBuyer()
    const { seller } = await createTestSeller(owner)
    const { returnRequest } = await createTestReturnRequest(owner, {
      buyerId: other.userId,
      sellerId: seller.id,
    })
    const photo = await readyPhoto(buyer)
    await expect(attach(buyer, returnRequest.id, [photo])).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('opening a photo', () => {
  test('the buyer, the seller of the return, and administrators get a link', async () => {
    const buyer = await newBuyer()
    const { owner: sellerUser, seller } = await createTestSeller(owner)
    const { owner: otherUser, seller: otherSeller } =
      await createTestSeller(owner)
    const photo = await readyPhoto(buyer)
    const link = (context: RequestContext) =>
      getReturnPhotoDownload({ db: web, storage }, context, photo)
    const sellerContext: RequestContext = {
      role: 'seller',
      userId: sellerUser.id,
      sellerId: seller.id,
    }
    const admin: RequestContext = {
      role: 'admin',
      userId: (await createTestUser(owner, 'admin')).id,
    }

    const forBuyer = await link(buyer)
    expect(forBuyer.fileName).toBe(`return-photo-${photo.slice(0, 8)}.jpg`)
    const response = await fetch(forBuyer.url)
    expect(response.status).toBe(200)
    expect(
      (await sharp(Buffer.from(await response.arrayBuffer())).metadata())
        .format,
    ).toBe('jpeg')
    await link(admin)
    // The seller only once the photo is part of a return of theirs.
    await expect(link(sellerContext)).rejects.toThrow(NotFoundError)
    const { returnRequest } = await createTestReturnRequest(owner, {
      buyerId: buyer.userId,
      sellerId: seller.id,
    })
    await attach(buyer, returnRequest.id, [photo])
    await link(sellerContext)
    await expect(
      link({ role: 'seller', userId: otherUser.id, sellerId: otherSeller.id }),
    ).rejects.toThrow(NotFoundError)
    await expect(link(await newBuyer())).rejects.toThrow(NotFoundError)
    await expect(link({ role: 'anonymous' })).rejects.toThrow(NotSignedInError)
  })

  test('409 until the photo is checked', async () => {
    const buyer = await newBuyer()
    const photo = await upload(buyer, Buffer.from('not a photo'))
    const link = () =>
      getReturnPhotoDownload({ db: web, storage }, buyer, photo.id)
    expect((await rejectionOf(link(), ConflictError)).message).toBe(
      'The photo is still being checked; try again in a moment',
    )
    await checkUploadedReturnPhoto(deps, photo.id)
    expect((await rejectionOf(link(), ConflictError)).message).toBe(
      'This photo failed the check, so there is nothing to show',
    )
  })
})
