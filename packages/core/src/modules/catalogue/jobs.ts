import { and, eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import {
  productImages,
  productVideos,
  products,
} from '../../db/schema/index.ts'
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
import { jobQueueOf } from '../../lib/queue.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import type { AiModels } from '../../lib/ai/index.ts'
import {
  prepareProductVideo,
  VideoRejectedError,
  type PreparedVideo,
  type VideoTools,
} from '../../lib/video-processing.ts'
import {
  MAX_VIDEO_UPLOAD_BYTES,
  videoFileKey,
  videoPosterKey,
} from '../../lib/videos.ts'
import {
  DRAFT_LISTING_QUEUE,
  draftListingJob,
  writeListingDraft,
} from './drafts.ts'
import {
  EMBED_MISSING_QUEUE,
  EMBED_PRODUCT_QUEUE,
  embedProduct,
  embedProductJob,
  queueMissingEmbeddings,
} from './embeddings.ts'
import { PROCESS_IMAGE_QUEUE, processImageJob } from './images.ts'
import {
  SCREEN_LISTING_QUEUE,
  screenListing,
  screenListingJob,
} from './screening.ts'
import { refreshProducts } from './summary.ts'
import { PROCESS_VIDEO_QUEUE, processVideoJob } from './videos.ts'

/*
 * The worker's catalogue jobs (backend spec steps 6, 7, and 18 to 20, and
 * product videos). Only the worker loads this file, because it loads the
 * image library and runs ffmpeg.
 */

export interface CatalogueJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  storage: ObjectStorage
  videoTools: VideoTools
}
type StorageJobDependencies = Pick<CatalogueJobDependencies, 'db' | 'storage'>

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
  deps: StorageJobDependencies,
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
  deps: StorageJobDependencies,
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

const VIDEO_GIVE_UP = 'The video could not be processed; add it again'

type VideoRow = typeof productVideos.$inferSelect

async function markVideoFailed(
  deps: StorageJobDependencies,
  video: VideoRow,
  reason: string,
): Promise<void> {
  await deps.db
    .update(productVideos)
    .set({ status: 'failed', failureReason: reason })
    .where(
      and(
        eq(productVideos.id, video.id),
        eq(productVideos.status, 'processing'),
      ),
    )
  if (video.uploadKey) await removeUpload(deps.storage, video.uploadKey)
}

async function storeVideo(
  storage: ObjectStorage,
  video: VideoRow,
  original: Buffer,
  prepared: PreparedVideo,
): Promise<void> {
  // The original stays private, so the video can be converted again later.
  await storage.write(`originals/${video.id}`, original, {
    contentType: 'application/octet-stream',
  })
  await storage.write(videoFileKey(video.storageKey), prepared.video, {
    contentType: 'video/mp4',
    cacheControl: IMMUTABLE,
  })
  await storage.write(videoPosterKey(video.storageKey), prepared.poster, {
    contentType: 'image/jpeg',
    cacheControl: IMMUTABLE,
  })
}

/**
 * Checks an uploaded video, converts it, and stores the public files, then
 * marks it ready, or failed with a reason the seller sees. Running twice
 * does nothing more, and a video removed in the meantime is left alone.
 *
 * Storage and ffmpeg start-up errors are thrown, so pg-boss retries; on the
 * `lastAttempt` the video is marked failed instead.
 */
export async function processUploadedVideo(
  deps: CatalogueJobDependencies,
  videoId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [video] = await deps.db
    .select()
    .from(productVideos)
    .where(eq(productVideos.id, videoId))
  if (!video || video.status !== 'processing' || !video.uploadKey) return

  let prepared: PreparedVideo
  try {
    const original = await deps.storage.read(video.uploadKey)
    if (!original) {
      await markVideoFailed(
        deps,
        video,
        'The upload did not arrive; add the video again',
      )
      return
    }
    if (original.length > MAX_VIDEO_UPLOAD_BYTES) {
      await markVideoFailed(deps, video, 'The file is larger than 50 MB')
      return
    }
    prepared = await prepareProductVideo(deps.videoTools, original)
    await storeVideo(deps.storage, video, original, prepared)
  } catch (error) {
    if (error instanceof VideoRejectedError) {
      await markVideoFailed(deps, video, error.message)
      return
    }
    if (lastAttempt) {
      console.error(`Giving up on video ${video.id}`, error)
      await markVideoFailed(deps, video, VIDEO_GIVE_UP)
      return
    }
    throw error
  }

  await deps.db.transaction(async (tx) => {
    // The product first, like every other change to it.
    await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, video.productId))
      .for('update')
    await tx
      .update(productVideos)
      .set({
        status: 'ready',
        durationMs: prepared.durationMs,
        width: prepared.width,
        height: prepared.height,
      })
      .where(
        and(
          eq(productVideos.id, video.id),
          eq(productVideos.status, 'processing'),
        ),
      )
  })
  await removeUpload(deps.storage, video.uploadKey)
}

export async function registerCatalogueJobs(
  boss: PgBoss,
  deps: CatalogueJobDependencies & {
    /**
     * For the listing builder (step 19) and the AI screening checks (step
     * 20); null when AI_ENABLED is false.
     */
    ai: AiModels | null
  },
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
  await boss.work(
    PROCESS_VIDEO_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { videoId } = processVideoJob.parse(job.data)
      await processUploadedVideo(deps, videoId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
  await boss.work(
    SCREEN_LISTING_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { reviewId } = screenListingJob.parse(job.data)
      await screenListing(deps, reviewId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
  await boss.work(
    DRAFT_LISTING_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      await writeListingDraft(deps, draftListingJob.parse(job.data), {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
  await boss.work(
    EMBED_PRODUCT_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      await embedProduct(deps, embedProductJob.parse(job.data).productId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
  // Every 15 minutes: products approved while AI was off, or embedded with
  // another model (backend spec step 18).
  await boss.schedule(EMBED_MISSING_QUEUE, '*/15 * * * *', null, {
    tz: 'Asia/Kolkata',
  })
  const { ai } = deps
  await boss.work(EMBED_MISSING_QUEUE, async () => {
    if (ai === null) return
    await queueMissingEmbeddings(deps.db, jobQueueOf(boss), ai.embed.model)
  })
}
