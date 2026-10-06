import { and, eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { productImages, products } from '../../db/schema/index.ts'
import {
  ImageRejectedError,
  prepareProductImage,
  type PreparedImage,
} from '../../lib/image-processing.ts'
import {
  IMAGE_SIZE_NAMES,
  imageSizeKey,
  MAX_UPLOAD_BYTES,
} from '../../lib/images.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { PROCESS_IMAGE_QUEUE, processImageJob } from './images.ts'
import { refreshProducts } from './summary.ts'

/*
 * The worker's catalogue jobs (backend spec step 6). Only the worker loads
 * this file, because it loads the image library.
 */

export interface CatalogueJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  storage: ObjectStorage
}

/** Sizes never change once written, so browsers and CloudFront keep them. */
const IMMUTABLE = 'public, max-age=31536000, immutable'
const GIVE_UP = 'The photo could not be processed; add it again'

type ImageRow = typeof productImages.$inferSelect

async function removeUpload(
  storage: ObjectStorage,
  key: string,
): Promise<void> {
  try {
    await storage.remove(key)
  } catch (error) {
    // The bucket's lifecycle rule deletes leftover uploads after a day.
    console.warn(`Could not remove the upload ${key}`, error)
  }
}

async function markFailed(
  deps: CatalogueJobDependencies,
  image: ImageRow,
  reason: string,
): Promise<void> {
  await deps.db
    .update(productImages)
    .set({ status: 'failed', failureReason: reason })
    .where(
      and(
        eq(productImages.id, image.id),
        eq(productImages.status, 'processing'),
      ),
    )
  if (image.uploadKey) await removeUpload(deps.storage, image.uploadKey)
}

async function storeSizes(
  storage: ObjectStorage,
  image: ImageRow,
  original: Buffer,
  prepared: PreparedImage,
): Promise<void> {
  // The original stays private, so new sizes can be made later.
  await storage.write(`originals/${image.id}`, original, {
    contentType: prepared.contentType,
  })
  for (const size of IMAGE_SIZE_NAMES) {
    await storage.write(
      imageSizeKey(image.storageKey, size),
      prepared.sizes[size],
      {
        contentType: 'image/webp',
        cacheControl: IMMUTABLE,
      },
    )
  }
}

/**
 * Checks an uploaded photo and stores its sizes, then marks it ready, or
 * failed with a reason the seller sees. Running twice does nothing more, and
 * a photo removed in the meantime is left alone.
 *
 * Storage errors are thrown, so pg-boss retries; on the `lastAttempt` the
 * photo is marked failed instead.
 */
export async function processUploadedImage(
  deps: CatalogueJobDependencies,
  imageId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [image] = await deps.db
    .select()
    .from(productImages)
    .where(eq(productImages.id, imageId))
  if (!image || image.status !== 'processing' || !image.uploadKey) return

  let prepared: PreparedImage
  let original: Buffer | null
  try {
    original = await deps.storage.read(image.uploadKey)
    if (!original) {
      await markFailed(
        deps,
        image,
        'The upload did not arrive; add the photo again',
      )
      return
    }
    if (original.length > MAX_UPLOAD_BYTES) {
      await markFailed(deps, image, 'The file is larger than 10 MB')
      return
    }
    prepared = await prepareProductImage(original)
    await storeSizes(deps.storage, image, original, prepared)
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      await markFailed(deps, image, error.message)
      return
    }
    if (lastAttempt) {
      console.error(`Giving up on photo ${image.id}`, error)
      await markFailed(deps, image, GIVE_UP)
      return
    }
    throw error
  }

  await deps.db.transaction(async (tx) => {
    // The product first, like every other change to it.
    await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, image.productId))
      .for('update')
    const [ready] = await tx
      .update(productImages)
      .set({
        status: 'ready',
        contentHash: prepared.contentHash,
        width: prepared.width,
        height: prepared.height,
      })
      .where(
        and(
          eq(productImages.id, image.id),
          eq(productImages.status, 'processing'),
        ),
      )
      .returning({ id: productImages.id })
    if (ready) await refreshProducts(tx, eq(products.id, image.productId))
  })
  await removeUpload(deps.storage, image.uploadKey)
}

export async function registerCatalogueJobs(
  boss: PgBoss,
  deps: CatalogueJobDependencies,
): Promise<void> {
  await boss.work(
    PROCESS_IMAGE_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { imageId } = processImageJob.parse(job.data)
      await processUploadedImage(deps, imageId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
}
