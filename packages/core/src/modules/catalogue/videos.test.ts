import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { products, productVideos } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, NotFoundError } from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { createObjectStorage, loadStorageConfig } from '../../lib/storage.ts'
import { loadVideoTools } from '../../lib/video-processing.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestCategory,
  createTestPhoto,
  createTestProduct,
  createTestSeller,
} from '../../testing/fixtures.ts'
import { createTestSound, createTestVideo } from '../../testing/videos.ts'
import { createImageUpload } from './images.ts'
import { processUploadedVideo } from './jobs.ts'
import { submitProduct } from './moderation.ts'
import { createProduct, getOwnProduct, type SellerContext } from './products.ts'
import type { ImageUpload, ProductView } from './types.ts'
import {
  addVideo,
  createVideoUpload,
  PROCESS_VIDEO_QUEUE,
  removeVideo,
} from './videos.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'videos-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const videoTools = loadVideoTools()
const jobs = { db: worker, storage, videoTools }
// ffmpeg shares the machine with every other test file.
const VIDEO_TEST_MS = 90_000
let queue: JobQueue
let seller: SellerContext
let categoryId: string

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'videos-test')
  const { owner: user, seller: business } = await createTestSeller(owner)
  seller = { role: 'seller', userId: user.id, sellerId: business.id }
  categoryId = (await createTestCategory(owner)).id
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

const as = <T>(
  context: RequestContext,
  work: (tx: Parameters<Parameters<typeof withContext>[2]>[0]) => Promise<T>,
) => withContext(web, context, work)

const newProduct = () =>
  as(seller, (tx) =>
    createProduct(tx, storage, seller, {
      categoryId,
      title: 'Coir Door Mat',
      variants: [
        { sku: 'CDM-1', pricePaise: 49_900, mrpPaise: 59_900, stock: 20 },
      ],
    }),
  )

const requestUpload = (
  product: ProductView,
  input: unknown = { contentType: 'video/mp4', size: 2_000_000 },
) => createVideoUpload({ db: web, storage }, seller, product.id, input)

/** Posts the file with the signed form, the way a browser does. */
async function upload(form: ImageUpload, bytes: Buffer): Promise<void> {
  const body = new FormData()
  for (const [name, value] of Object.entries(form.fields))
    body.append(name, value)
  body.append('file', new Blob([bytes]))
  const response = await fetch(form.url, { method: 'POST', body })
  expect(response.status).toBe(204)
}

const add = (product: ProductView, input: unknown) =>
  as(seller, (tx) => addVideo(tx, storage, queue, seller, product.id, input))

/** Uploads and adds a video, and returns its id. */
async function addVideoFile(
  product: ProductView,
  bytes?: Buffer,
): Promise<{ id: string; form: ImageUpload }> {
  const form = await requestUpload(product)
  if (bytes) await upload(form, bytes)
  const view = await add(product, { uploadKey: form.key })
  return { id: view.video!.id, form }
}

const view = (product: ProductView) =>
  as(seller, (tx) => getOwnProduct(tx, storage, seller, product.id))
const videoRow = async (id: string) =>
  (await owner.select().from(productVideos).where(eq(productVideos.id, id)))[0]

const probeOutput = z.object({
  format: z.object({ format_name: z.string() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      pix_fmt: z.string().optional(),
      r_frame_rate: z.string(),
    }),
  ),
})

/** What ffprobe finds in a file. */
async function probeFile(bytes: Buffer) {
  const folder = await mkdtemp(join(tmpdir(), 'ecokart-test-probe-'))
  try {
    const file = join(folder, 'file')
    await writeFile(file, bytes)
    const { stdout } = await promisify(execFile)(videoTools.ffprobePath, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file,
    ])
    return probeOutput.parse(JSON.parse(stdout))
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

const download = async (url: string) => {
  const response = await fetch(url)
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    bytes: Buffer.from(await response.arrayBuffer()),
  }
}

describe('uploading a video', () => {
  test('signs a form for one video key under the product, valid for 30 minutes', async () => {
    const product = await newProduct()
    const form = await requestUpload(product)
    expect(form.key).toMatch(
      new RegExp(`^uploads/${product.id}/video-[0-9a-f-]{36}$`),
    )
    expect(form.maxBytes).toBe(50 * 1024 * 1024)
    expect(form.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      29 * 60 * 1000,
    )
    await upload(form, await createTestVideo())
    expect(await storage.read(form.key)).not.toBeNull()
  })

  test('refuses other file types and files over 50 MB', async () => {
    const product = await newProduct()
    expect(
      await validationIssues(
        requestUpload(product, {
          contentType: 'video/x-msvideo',
          size: 51 * 1024 * 1024,
        }),
      ),
    ).toEqual([
      'contentType must be video/mp4, video/quicktime, or video/webm',
      'size must be at most 50 MB',
    ])
  })
})

describe('adding a video', () => {
  test('creates a processing video and queues its job in the same transaction', async () => {
    const product = await newProduct()
    const { id } = await addVideoFile(product)

    expect((await view(product)).video).toEqual({
      id,
      status: 'processing',
      failureReason: null,
      durationMs: null,
      width: null,
      height: null,
      urls: null,
    })
    const queued = await owner.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${PROCESS_VIDEO_QUEUE} and data->>'videoId' = ${id}`,
    )
    expect(queued.rows[0]).toEqual({ count: 1 })
  })

  test("refuses a photo upload and another product's video upload", async () => {
    const product = await newProduct()
    const other = await newProduct()
    const photo = await createImageUpload(
      { db: web, storage },
      seller,
      product.id,
      { contentType: 'image/jpeg', size: 200_000 },
    )
    const otherVideo = await requestUpload(other)
    for (const uploadKey of [photo.key, otherVideo.key, '../secrets']) {
      expect(await validationIssues(add(product, { uploadKey }))).toEqual([
        'uploadKey is not a video upload for this product',
      ])
    }
  })

  test('allows one video per product', async () => {
    const product = await newProduct()
    await addVideoFile(product)
    const oneVideo = new ConflictError(
      'A product can have one video; remove the current one first',
    )
    await expect(requestUpload(product)).rejects.toThrow(oneVideo)
    await expect(
      add(product, {
        uploadKey: `uploads/${product.id}/video-${randomUUID()}`,
      }),
    ).rejects.toThrow(oneVideo)
    // The database itself refuses a second row.
    await expect(
      owner.insert(productVideos).values({
        productId: product.id,
        storageKey: `videos/${randomUUID()}`,
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'product_videos_product_id_unique',
      }),
    })
  })

  test('only while listing details may change', async () => {
    const product = await newProduct()
    const form = await requestUpload(product)
    await owner
      .update(products)
      .set({ status: 'pending_review' })
      .where(eq(products.id, product.id))
    await expect(requestUpload(product)).rejects.toThrow(ConflictError)
    await expect(add(product, { uploadKey: form.key })).rejects.toThrow(
      ConflictError,
    )
  })
})

describe('the video job', () => {
  test(
    'converts a video with sound to 720p H.264 and AAC with a poster, and keeps the original private',
    async () => {
      const product = await newProduct()
      const original = await createTestVideo({
        width: 1600,
        height: 900,
        framesPerSecond: 60,
        format: 'mov',
        sound: true,
      })
      const { id, form } = await addVideoFile(product, original)

      await processUploadedVideo(jobs, id)

      const video = (await view(product)).video!
      expect(video).toMatchObject({
        id,
        status: 'ready',
        failureReason: null,
        width: 1280,
        height: 720,
      })
      expect(video.durationMs).toBeGreaterThanOrEqual(900)
      expect(video.durationMs).toBeLessThanOrEqual(1200)

      const file = await download(video.urls!.video)
      expect([file.status, file.contentType, file.cacheControl]).toEqual([
        200,
        'video/mp4',
        'public, max-age=31536000, immutable',
      ])
      const probed = await probeFile(file.bytes)
      expect(
        probed.streams.map((stream) => [
          stream.codec_type,
          stream.codec_name,
          stream.width,
          stream.height,
          stream.pix_fmt,
        ]),
      ).toEqual([
        ['video', 'h264', 1280, 720, 'yuv420p'],
        ['audio', 'aac', undefined, undefined, undefined],
      ])
      expect(probed.streams[0]!.r_frame_rate).toBe('30/1')
      // Fast start: the index comes before the picture data.
      expect(file.bytes.indexOf('moov')).toBeLessThan(
        file.bytes.indexOf('mdat'),
      )

      const poster = await download(video.urls!.poster)
      expect([poster.status, poster.contentType]).toEqual([200, 'image/jpeg'])
      const metadata = await sharp(poster.bytes).metadata()
      expect([metadata.format, metadata.width, metadata.height]).toEqual([
        'jpeg',
        1280,
        720,
      ])

      // The upload is gone; the original is kept, but not public.
      expect(await storage.read(form.key)).toBeNull()
      expect(await storage.read(`originals/${id}`)).toEqual(original)
      expect((await fetch(storage.publicUrl(`originals/${id}`))).status).toBe(
        403,
      )

      // Running the job again changes nothing.
      await processUploadedVideo(jobs, id)
      expect((await videoRow(id))?.status).toBe('ready')
    },
    VIDEO_TEST_MS,
  )

  test(
    'fits an upright video inside 720 by 1280 and never enlarges a small one',
    async () => {
      const upright = await newProduct()
      const small = await newProduct()
      const tall = await addVideoFile(
        upright,
        await createTestVideo({ width: 1080, height: 1920 }),
      )
      const tiny = await addVideoFile(
        small,
        await createTestVideo({ width: 320, height: 240, format: 'webm' }),
      )
      await processUploadedVideo(jobs, tall.id)
      await processUploadedVideo(jobs, tiny.id)

      expect((await view(upright)).video).toMatchObject({
        status: 'ready',
        width: 720,
        height: 1280,
      })
      expect((await view(small)).video).toMatchObject({
        status: 'ready',
        width: 320,
        height: 240,
      })
    },
    VIDEO_TEST_MS,
  )

  test(
    'marks a video failed, with a reason the seller sees',
    async () => {
      const cases: [Buffer | undefined, string][] = [
        [undefined, 'The upload did not arrive; add the video again'],
        [
          Buffer.from('not a video at all'),
          'The file is not an MP4, MOV, or WebM video',
        ],
        [
          await sharp({
            create: { width: 64, height: 64, channels: 3, background: '#000' },
          })
            .png()
            .toBuffer(),
          'The file is not an MP4, MOV, or WebM video',
        ],
        [
          await createTestSound(),
          'The file has no picture in it; add a video, not only sound',
        ],
        [
          await createTestVideo({
            width: 64,
            height: 64,
            seconds: 61,
            framesPerSecond: 1,
          }),
          'The video is longer than 60 seconds',
        ],
      ]
      for (const [bytes, reason] of cases) {
        const product = await newProduct()
        const { id, form } = await addVideoFile(product, bytes)
        await processUploadedVideo(jobs, id)
        expect(await videoRow(id)).toMatchObject({
          status: 'failed',
          failureReason: reason,
        })
        expect((await view(product)).video?.urls).toBeNull()
        expect(await storage.read(form.key)).toBeNull()
      }
    },
    VIDEO_TEST_MS,
  )

  test(
    'refuses a file over 50 MB that reached storage another way',
    async () => {
      const product = await newProduct()
      // The signed form stops this; the job checks again in case a file got
      // there some other way.
      const key = `uploads/${product.id}/video-${randomUUID()}`
      await storage.write(key, Buffer.alloc(50 * 1024 * 1024 + 1), {
        contentType: 'video/mp4',
      })
      const { video } = await add(product, { uploadKey: key })
      await processUploadedVideo(jobs, video!.id)
      expect(await videoRow(video!.id)).toMatchObject({
        status: 'failed',
        failureReason: 'The file is larger than 50 MB',
      })
      expect(await storage.read(key)).toBeNull()
    },
    VIDEO_TEST_MS,
  )

  test('retries when ffmpeg cannot run, and gives up with a reason on the last attempt', async () => {
    const product = await newProduct()
    const { id } = await addVideoFile(product, await createTestVideo())
    const broken = {
      ...jobs,
      videoTools: {
        ffmpegPath: '/nowhere/ffmpeg',
        ffprobePath: '/nowhere/ffprobe',
      },
    }

    await expect(
      processUploadedVideo(broken, id, { lastAttempt: false }),
    ).rejects.toThrow('ENOENT')
    expect((await videoRow(id))?.status).toBe('processing')

    await processUploadedVideo(broken, id, { lastAttempt: true })
    expect(await videoRow(id)).toMatchObject({
      status: 'failed',
      failureReason: 'The video could not be processed; add it again',
    })
  })

  test('leaves a video alone that was removed while it waited', async () => {
    const product = await newProduct()
    const { id } = await addVideoFile(product, await createTestVideo())
    await as(seller, (tx) => removeVideo(tx, storage, seller, product.id))
    await processUploadedVideo(jobs, id)
    expect(await videoRow(id)).toBeUndefined()
  })
})

describe('removing a video', () => {
  test(
    'removes the video, so another can be added; the files stay',
    async () => {
      const product = await newProduct()
      const { id } = await addVideoFile(product, await createTestVideo())
      await processUploadedVideo(jobs, id)

      const removed = await as(seller, (tx) =>
        removeVideo(tx, storage, seller, product.id),
      )
      expect(removed.video).toBeNull()
      expect(await storage.read(`videos/${id}/video.mp4`)).not.toBeNull()
      await expect(
        as(seller, (tx) => removeVideo(tx, storage, seller, product.id)),
      ).rejects.toThrow(new NotFoundError('This product has no video'))
      await expect(requestUpload(product)).resolves.toBeDefined()
    },
    VIDEO_TEST_MS,
  )

  test("never touches another seller's video", async () => {
    const product = await newProduct()
    const { id } = await addVideoFile(product)
    const { owner: user, seller: business } = await createTestSeller(owner)
    const other: SellerContext = {
      role: 'seller',
      userId: user.id,
      sellerId: business.id,
    }
    await expect(
      as(other, (tx) => removeVideo(tx, storage, other, product.id)),
    ).rejects.toThrow(NotFoundError)
    expect(await videoRow(id)).toBeDefined()
  })
})

describe('a video and the rest of the listing', () => {
  test(
    'a listing waits for its video before it can be submitted',
    async () => {
      const product = await newProduct()
      await createTestPhoto(owner, product.id)
      const { id } = await addVideoFile(product, await createTestVideo())
      const submit = () =>
        as(seller, (tx) =>
          submitProduct(tx, storage, queue, seller, product.id),
        )

      expect(await validationIssues(submit())).toEqual([
        'Wait until the video has been processed, which takes up to a few minutes',
      ])
      await processUploadedVideo(jobs, id)
      expect((await submit()).status).toBe('pending_review')
    },
    VIDEO_TEST_MS,
  )

  test('visitors see the video of a listing on sale, and not of a draft', async () => {
    const { seller: business } = await createTestSeller(owner)
    const { product: onSale } = await createTestProduct(owner, {
      sellerId: business.id,
      categoryId,
    })
    const { product: draft } = await createTestProduct(owner, {
      sellerId: business.id,
      categoryId,
      status: 'draft',
    })
    for (const product of [onSale, draft]) {
      await owner.insert(productVideos).values({
        productId: product.id,
        storageKey: `videos/${randomUUID()}`,
        status: 'ready',
        durationMs: 5000,
        width: 1280,
        height: 720,
      })
    }
    const seen = await as({ role: 'anonymous' }, (tx) =>
      tx
        .select({ productId: productVideos.productId })
        .from(productVideos)
        .where(sql`${productVideos.productId} in (${onSale.id}, ${draft.id})`),
    )
    expect(seen).toEqual([{ productId: onSale.id }])
  })
})
