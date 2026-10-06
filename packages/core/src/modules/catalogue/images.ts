import { randomUUID } from 'node:crypto'
import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import {
  productImages,
  productVariants,
  products,
} from '../../db/schema/index.ts'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.ts'
import { MAX_UPLOAD_BYTES } from '../../lib/images.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import type { JobQueue, QueueDefinition } from '../../lib/queue.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import {
  assertEditable,
  assertSeller,
  lockOwnProduct,
  readProductView,
  throwIfAny,
  type PhotoAddresses,
} from './products.ts'
import { refreshProducts } from './summary.ts'
import {
  imageOrder,
  imageUpdate,
  imageUploadRequest,
  newImage,
  type ImageUpload,
  type ProductView,
} from './types.ts'

/*
 * Product photos (backend spec step 6). The browser uploads the file straight
 * to object storage with a signed form, then adds it here; the worker checks
 * it and makes the sizes (jobs.ts). Photos change only while listing details
 * may change.
 */

export const PROCESS_IMAGE_QUEUE = 'catalogue.process-image'

export const catalogueQueues: QueueDefinition[] = [
  {
    name: PROCESS_IMAGE_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const processImageJob = z.object({ imageId: z.uuid() })

export const MAX_IMAGES_PER_PRODUCT = 10
const UPLOAD_FORM_SECONDS = 10 * 60
const UPLOAD_KEY =
  /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const INVALID = 'That photo cannot be added'
const NOT_FOUND = 'There is no photo with that id'

/** Failed photos do not count, so the seller can try again. */
async function assertRoomForPhoto(
  tx: Transaction,
  productId: string,
): Promise<void> {
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(productImages)
    .where(
      and(
        eq(productImages.productId, productId),
        ne(productImages.status, 'failed'),
      ),
    )
  if (count >= MAX_IMAGES_PER_PRODUCT) {
    throw new ConflictError(
      `A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos; remove one first`,
    )
  }
}

async function variantIssue(
  tx: Transaction,
  productId: string,
  variantId: string | null | undefined,
): Promise<string | null> {
  if (!variantId) return null
  const [variant] = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(productVariants.productId, productId),
      ),
    )
  return variant ? null : 'variantId is not a variant of this product'
}

/**
 * Signs a form the browser uploads one photo with. The checks run in a
 * transaction first; signing happens outside it.
 */
export async function createImageUpload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  productId: string,
  input: unknown,
): Promise<ImageUpload> {
  assertSeller(context)
  const request = parseInput(
    imageUploadRequest,
    input,
    'That photo cannot be uploaded',
  )
  await withContext(db, context, async (tx) => {
    assertEditable(await lockOwnProduct(tx, context, productId))
    await assertRoomForPhoto(tx, productId)
  })
  const key = `uploads/${productId}/${randomUUID()}`
  const form = await storage.createUploadForm(key, {
    contentType: request.contentType,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresInSeconds: UPLOAD_FORM_SECONDS,
  })
  return {
    key,
    ...form,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresAt: new Date(Date.now() + UPLOAD_FORM_SECONDS * 1000),
  }
}

/**
 * Adds an uploaded photo as `processing` and queues the job that checks it
 * and makes its sizes, in the same transaction.
 */
export async function addImage(
  tx: Transaction,
  photos: PhotoAddresses,
  queue: JobQueue,
  context: RequestContext,
  productId: string,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const details = parseInput(newImage, input, INVALID)
  if (UPLOAD_KEY.exec(details.uploadKey)?.[1] !== productId) {
    throw new ValidationError(INVALID, [
      'uploadKey is not an upload for this product',
    ])
  }
  const product = await lockOwnProduct(tx, context, productId)
  assertEditable(product)
  await assertRoomForPhoto(tx, productId)
  throwIfAny(INVALID, [await variantIssue(tx, productId, details.variantId)])

  const [{ last } = { last: -1 }] = await tx
    .select({
      last: sql<number>`coalesce(max(${productImages.sortOrder}), -1)::int`,
    })
    .from(productImages)
    .where(eq(productImages.productId, productId))
  const id = randomUUID()
  try {
    await tx.insert(productImages).values({
      id,
      productId,
      variantId: details.variantId ?? null,
      storageKey: `images/${id}`,
      uploadKey: details.uploadKey,
      status: 'processing',
      alt: details.alt ?? '',
      sortOrder: last + 1,
    })
  } catch (error) {
    if (uniqueViolation(error) === 'product_images_upload_key_unique') {
      throw new ValidationError(INVALID, ['uploadKey was already added'])
    }
    throw error
  }
  await queue.send(tx, PROCESS_IMAGE_QUEUE, { imageId: id })
  return readProductView(tx, photos, productId)
}

async function findImage(
  tx: Transaction,
  productId: string,
  imageId: string,
): Promise<void> {
  if (!isUuid(imageId)) throw new NotFoundError(NOT_FOUND)
  const [image] = await tx
    .select({ id: productImages.id })
    .from(productImages)
    .where(
      and(
        eq(productImages.id, imageId),
        eq(productImages.productId, productId),
      ),
    )
  if (!image) throw new NotFoundError(NOT_FOUND)
}

/** Puts every photo of the product in the given order; the first is the main one. */
export async function setImageOrder(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const { imageIds } = parseInput(
    imageOrder,
    input,
    'That photo order is not valid',
  )
  assertEditable(await lockOwnProduct(tx, context, productId))
  const current = await tx
    .select({ id: productImages.id })
    .from(productImages)
    .where(eq(productImages.productId, productId))
  const listed = new Set(imageIds)
  if (
    listed.size !== imageIds.length ||
    imageIds.length !== current.length ||
    current.some((image) => !listed.has(image.id))
  ) {
    throw new ValidationError('That photo order is not valid', [
      'imageIds must list every photo of the product exactly once',
    ])
  }
  for (const [sortOrder, id] of imageIds.entries()) {
    await tx
      .update(productImages)
      .set({ sortOrder })
      .where(eq(productImages.id, id))
  }
  await refreshProducts(tx, eq(products.id, productId))
  return readProductView(tx, photos, productId)
}

/** Changes a photo's alt text or the variant it shows. */
export async function updateImage(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  imageId: string,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const changes = parseInput(
    imageUpdate,
    input,
    'Those photo details are not valid',
  )
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  assertEditable(await lockOwnProduct(tx, context, productId))
  await findImage(tx, productId, imageId)
  throwIfAny('Those photo details are not valid', [
    await variantIssue(tx, productId, changes.variantId),
  ])
  await tx
    .update(productImages)
    .set(changes)
    .where(eq(productImages.id, imageId))
  return readProductView(tx, photos, productId)
}

/**
 * Removes a photo from the product. The stored files stay, because past
 * orders show the photo they were placed with.
 */
export async function removeImage(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  imageId: string,
): Promise<ProductView> {
  assertSeller(context)
  assertEditable(await lockOwnProduct(tx, context, productId))
  await findImage(tx, productId, imageId)
  await tx.delete(productImages).where(eq(productImages.id, imageId))
  await refreshProducts(tx, eq(products.id, productId))
  return readProductView(tx, photos, productId)
}
