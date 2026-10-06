import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { productImages, products } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, NotFoundError } from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '../../lib/storage.ts'
import { validationIssues } from '../../testing/errors.ts'
import { createTestCategory, createTestSeller } from '../../testing/fixtures.ts'
import {
  addImage,
  createImageUpload,
  MAX_IMAGES_PER_PRODUCT,
  PROCESS_IMAGE_QUEUE,
  removeImage,
  setImageOrder,
  updateImage,
} from './images.ts'
import { processUploadedImage } from './jobs.ts'
import { createProduct, getOwnProduct, type SellerContext } from './products.ts'
import type { ImageUpload, ProductView } from './types.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'images-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
let queue: JobQueue
let seller: SellerContext
let categoryId: string

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'images-test')
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

async function newProduct(): Promise<ProductView> {
  return as(seller, (tx) =>
    createProduct(tx, storage, seller, {
      categoryId,
      title: 'Jute Shopping Bag',
      optionNames: ['Colour'],
      variants: [
        {
          sku: 'JB-NAT',
          options: { Colour: 'Natural' },
          pricePaise: 34_900,
          mrpPaise: 39_900,
          stock: 40,
        },
        {
          sku: 'JB-GRN',
          options: { Colour: 'Green' },
          pricePaise: 34_900,
          mrpPaise: 39_900,
          stock: 25,
        },
      ],
    }),
  )
}

/** A phone photo with a GPS location in its metadata. */
const phonePhoto = (width = 1600, height = 1200) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 90, b: 40 },
    },
  })
    .withExif({
      IFD0: { Make: 'PhoneCo' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '18/1 31/1 0/1' },
    })
    .jpeg()
    .toBuffer()

const requestUpload = (
  product: ProductView,
  input: unknown = { contentType: 'image/jpeg', size: 200_000 },
) => createImageUpload({ db: web, storage }, seller, product.id, input)

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
  as(seller, (tx) => addImage(tx, storage, queue, seller, product.id, input))

/** Uploads and adds one photo, and returns its id. */
async function addPhoto(product: ProductView, bytes?: Buffer): Promise<string> {
  const form = await requestUpload(product)
  if (bytes) await upload(form, bytes)
  const view = await add(product, { uploadKey: form.key })
  return view.images.at(-1)!.id
}

const view = (product: ProductView) =>
  as(seller, (tx) => getOwnProduct(tx, storage, seller, product.id))
const imageRow = async (id: string) =>
  (await owner.select().from(productImages).where(eq(productImages.id, id)))[0]!

describe('uploading a photo', () => {
  test('signs a form for one key under the product, valid for 10 minutes', async () => {
    const product = await newProduct()
    const form = await requestUpload(product)
    expect(form.key).toMatch(
      new RegExp(`^uploads/${product.id}/[0-9a-f-]{36}$`),
    )
    expect(form.maxBytes).toBe(10 * 1024 * 1024)
    expect(form.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000)
    await upload(form, await phonePhoto())
    expect(await storage.read(form.key)).not.toBeNull()
  })

  test('refuses other file types and files over 10 MB', async () => {
    const product = await newProduct()
    expect(
      await validationIssues(
        requestUpload(product, {
          contentType: 'image/svg+xml',
          size: 11 * 1024 * 1024,
        }),
      ),
    ).toEqual([
      'contentType must be image/jpeg, image/png, image/webp, or image/avif',
      'size must be at most 10 MB',
    ])
  })
})

describe('adding a photo', () => {
  test('creates a processing photo and queues its job in the same transaction', async () => {
    const product = await newProduct()
    const id = await addPhoto(product)

    expect((await view(product)).images).toEqual([
      expect.objectContaining({
        id,
        status: 'processing',
        urls: null,
        sortOrder: 0,
      }),
    ])
    const jobs = await owner.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${PROCESS_IMAGE_QUEUE} and data->>'imageId' = ${id}`,
    )
    expect(jobs.rows[0]).toEqual({ count: 1 })
  })

  test('refuses an upload of another product, the same upload twice, and a variant of another product', async () => {
    const product = await newProduct()
    const other = await newProduct()
    const otherForm = await requestUpload(other)
    expect(
      await validationIssues(add(product, { uploadKey: otherForm.key })),
    ).toEqual(['uploadKey is not an upload for this product'])
    expect(
      await validationIssues(add(product, { uploadKey: '../secrets' })),
    ).toEqual(['uploadKey is not an upload for this product'])

    const form = await requestUpload(product)
    await add(product, { uploadKey: form.key })
    expect(
      await validationIssues(add(product, { uploadKey: form.key })),
    ).toEqual(['uploadKey was already added'])
    const fresh = await requestUpload(product)
    expect(
      await validationIssues(
        add(product, {
          uploadKey: fresh.key,
          variantId: other.variants[0]!.id,
        }),
      ),
    ).toEqual(['variantId is not a variant of this product'])
  })

  test(`allows at most ${MAX_IMAGES_PER_PRODUCT} photos, not counting failed ones`, async () => {
    const product = await newProduct()
    const ids: string[] = []
    for (let n = 0; n < MAX_IMAGES_PER_PRODUCT; n++)
      ids.push(await addPhoto(product))
    await expect(requestUpload(product)).rejects.toThrow(
      new ConflictError(
        'A product can have at most 10 photos; remove one first',
      ),
    )
    // A photo that failed makes room again.
    await processUploadedImage({ db: worker, storage }, ids[0]!)
    expect((await imageRow(ids[0]!)).status).toBe('failed')
    await expect(requestUpload(product)).resolves.toBeDefined()
  })

  test('only while listing details may change', async () => {
    const product = await newProduct()
    await owner
      .update(products)
      .set({ status: 'pending_review' })
      .where(eq(products.id, product.id))
    await expect(requestUpload(product)).rejects.toThrow(ConflictError)
  })
})

describe('the photo job', () => {
  test('stores three public sizes without metadata, keeps the original private, and makes it the main photo', async () => {
    const product = await newProduct()
    const original = await phonePhoto()
    const form = await requestUpload(product)
    await upload(form, original)
    const id = (
      await add(product, { uploadKey: form.key, alt: 'Natural jute bag' })
    ).images[0]!.id

    await processUploadedImage({ db: worker, storage }, id)

    const ready = await view(product)
    const image = ready.images[0]!
    expect(image).toMatchObject({
      id,
      status: 'ready',
      alt: 'Natural jute bag',
      width: 1600,
      height: 1200,
      failureReason: null,
    })
    const gallery = await fetch(image.urls!.gallery)
    expect(gallery.status).toBe(200)
    expect(gallery.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    const metadata = await sharp(
      Buffer.from(await gallery.arrayBuffer()),
    ).metadata()
    expect([metadata.format, metadata.width, metadata.exif]).toEqual([
      'webp',
      1200,
      undefined,
    ])
    expect((await fetch(image.urls!.thumb)).status).toBe(200)
    expect((await fetch(image.urls!.card)).status).toBe(200)

    // The upload is gone; the original is kept, but not public.
    expect(await storage.read(form.key)).toBeNull()
    expect(await storage.read(`originals/${id}`)).toEqual(original)
    expect((await fetch(storage.publicUrl(`originals/${id}`))).status).toBe(403)

    const [row] = await owner
      .select({ primaryImageId: products.primaryImageId })
      .from(products)
      .where(eq(products.id, product.id))
    expect(row).toEqual({ primaryImageId: id })
    expect((await imageRow(id)).contentHash).toMatch(/^[0-9a-f]{64}$/)

    // Running the job again changes nothing.
    await processUploadedImage({ db: worker, storage }, id)
    expect((await imageRow(id)).status).toBe('ready')
  })

  test('marks a photo failed, with a reason the seller sees', async () => {
    const product = await newProduct()
    const missing = await addPhoto(product)
    const tiny = await addPhoto(product, await phonePhoto(500, 400))
    const text = await addPhoto(product, Buffer.from('not a photo at all'))

    for (const id of [missing, tiny, text]) {
      await processUploadedImage({ db: worker, storage }, id)
    }

    expect(
      (await view(product)).images.map(({ status, failureReason }) => [
        status,
        failureReason,
      ]),
    ).toEqual([
      ['failed', 'The upload did not arrive; add the photo again'],
      [
        'failed',
        'The image is too small; it needs at least 600 pixels on its longer side',
      ],
      ['failed', 'The file is not a JPEG, PNG, WebP, or AVIF image'],
    ])
  })

  test('refuses a file over 10 MB that reached storage another way', async () => {
    const product = await newProduct()
    // The signed form stops this; the job checks again in case a file got
    // there some other way.
    const key = `uploads/${product.id}/${randomUUID()}`
    await storage.write(key, Buffer.alloc(10 * 1024 * 1024 + 1), {
      contentType: 'image/jpeg',
    })
    const id = (await add(product, { uploadKey: key })).images[0]!.id
    await processUploadedImage({ db: worker, storage }, id)
    expect(await imageRow(id)).toMatchObject({
      status: 'failed',
      failureReason: 'The file is larger than 10 MB',
    })
    expect(await storage.read(key)).toBeNull()
  })

  test('retries a storage failure, and gives up with a reason on the last attempt', async () => {
    const product = await newProduct()
    const id = await addPhoto(product, await phonePhoto())
    const broken: ObjectStorage = {
      ...storage,
      write: () => Promise.reject(new Error('Storage is down')),
    }

    await expect(
      processUploadedImage({ db: worker, storage: broken }, id, {
        lastAttempt: false,
      }),
    ).rejects.toThrow('Storage is down')
    expect((await imageRow(id)).status).toBe('processing')

    await processUploadedImage({ db: worker, storage: broken }, id, {
      lastAttempt: true,
    })
    expect(await imageRow(id)).toMatchObject({
      status: 'failed',
      failureReason: 'The photo could not be processed; add it again',
    })
  })

  test('leaves a photo alone that was removed while it waited', async () => {
    const product = await newProduct()
    const id = await addPhoto(product, await phonePhoto())
    await as(seller, (tx) => removeImage(tx, storage, seller, product.id, id))
    await processUploadedImage({ db: worker, storage }, id)
    expect(
      await owner.select().from(productImages).where(eq(productImages.id, id)),
    ).toEqual([])
  })
})

async function productWithPhotos(count: number) {
  const product = await newProduct()
  const ids: string[] = []
  for (let n = 0; n < count; n++) {
    const id = await addPhoto(product, await phonePhoto())
    await processUploadedImage({ db: worker, storage }, id)
    ids.push(id)
  }
  return { product, ids }
}

const primaryOf = async (product: ProductView) =>
  (
    await owner
      .select({ id: products.primaryImageId })
      .from(products)
      .where(eq(products.id, product.id))
  )[0]!.id

describe('arranging photos', () => {
  test('puts photos in order, and the first becomes the main photo', async () => {
    const { product, ids } = await productWithPhotos(3)
    const reordered = await as(seller, (tx) =>
      setImageOrder(tx, storage, seller, product.id, {
        imageIds: [ids[2], ids[0], ids[1]],
      }),
    )
    expect(reordered.images.map((image) => image.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ])
    expect(await primaryOf(product)).toBe(ids[2])

    expect(
      await validationIssues(
        as(seller, (tx) =>
          setImageOrder(tx, storage, seller, product.id, {
            imageIds: [ids[0], ids[0], ids[1]],
          }),
        ),
      ),
    ).toEqual(['imageIds must list every photo of the product exactly once'])
  })

  test('changes alt text and the variant a photo shows', async () => {
    const { product, ids } = await productWithPhotos(1)
    const green = product.variants[1]!.id
    const changed = await as(seller, (tx) =>
      updateImage(tx, storage, seller, product.id, ids[0]!, {
        alt: 'Green bag',
        variantId: green,
      }),
    )
    expect(changed.images[0]).toMatchObject({
      alt: 'Green bag',
      variantId: green,
    })
    await expect(
      as(seller, (tx) =>
        updateImage(tx, storage, seller, product.id, randomUUID(), {
          alt: 'x',
        }),
      ),
    ).rejects.toThrow(NotFoundError)
  })

  test('removing the main photo makes the next one the main photo', async () => {
    const { product, ids } = await productWithPhotos(2)
    await as(seller, (tx) =>
      removeImage(tx, storage, seller, product.id, ids[0]!),
    )
    expect(await primaryOf(product)).toBe(ids[1])
    // The removed photo's files stay for past orders.
    expect(await storage.read(`images/${ids[0]}/card.webp`)).not.toBeNull()
  })

  test("never touches another seller's photos", async () => {
    const { product, ids } = await productWithPhotos(1)
    const { owner: user, seller: business } = await createTestSeller(owner)
    const other: SellerContext = {
      role: 'seller',
      userId: user.id,
      sellerId: business.id,
    }
    await expect(
      as(other, (tx) => removeImage(tx, storage, other, product.id, ids[0]!)),
    ).rejects.toThrow(NotFoundError)
    expect(
      await owner
        .select({ id: productImages.id })
        .from(productImages)
        .where(
          and(eq(productImages.id, ids[0]!), eq(productImages.status, 'ready')),
        ),
    ).toHaveLength(1)
  })
})
