import { and, eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { returnPhotos } from '../../db/schema/index.ts'
import {
  ImageRejectedError,
  prepareReturnPhoto,
  type PreparedReturnPhoto,
} from '../../lib/image-processing.ts'
import { MAX_UPLOAD_BYTES } from '../../lib/images.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import {
  CHECK_RETURN_PHOTO_QUEUE,
  checkReturnPhotoJob,
  returnPhotoStorageKey,
} from './photos.ts'

/*
 * The worker's return jobs (design doc 5.7). Only the worker loads this
 * file, because it loads the image library.
 */

export interface ReturnJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  storage: ObjectStorage
}

const GIVE_UP = 'The photo could not be checked; add it again'

type PhotoRow = typeof returnPhotos.$inferSelect

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

/** Records the outcome once, then removes the upload. */
async function finish(
  deps: ReturnJobDependencies,
  photo: PhotoRow,
  outcome:
    | { status: 'ready'; prepared: PreparedReturnPhoto }
    | { status: 'failed'; reason: string },
): Promise<void> {
  await deps.db
    .update(returnPhotos)
    .set(
      outcome.status === 'ready'
        ? {
            status: 'ready',
            storageKey: returnPhotoStorageKey(photo.id),
            contentHash: outcome.prepared.contentHash,
            width: outcome.prepared.width,
            height: outcome.prepared.height,
          }
        : { status: 'failed', failureReason: outcome.reason },
    )
    .where(
      and(eq(returnPhotos.id, photo.id), eq(returnPhotos.status, 'processing')),
    )
  await removeUpload(deps.storage, photo.uploadKey)
}

/**
 * Checks an uploaded return photo and keeps a re-encoded private copy, then
 * marks it ready, or failed with a reason the buyer sees. Running twice
 * does nothing more.
 *
 * Storage errors are thrown, so pg-boss retries; on the `lastAttempt` the
 * photo is marked failed instead.
 */
export async function checkUploadedReturnPhoto(
  deps: ReturnJobDependencies,
  photoId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [photo] = await deps.db
    .select()
    .from(returnPhotos)
    .where(eq(returnPhotos.id, photoId))
  if (!photo || photo.status !== 'processing') return

  let prepared: PreparedReturnPhoto
  try {
    const original = await deps.storage.read(photo.uploadKey)
    if (!original) {
      await finish(deps, photo, {
        status: 'failed',
        reason: 'The upload did not arrive; add the photo again',
      })
      return
    }
    if (original.length > MAX_UPLOAD_BYTES) {
      await finish(deps, photo, {
        status: 'failed',
        reason: 'The file is larger than 10 MB',
      })
      return
    }
    prepared = await prepareReturnPhoto(original)
    await deps.storage.write(returnPhotoStorageKey(photo.id), prepared.bytes, {
      contentType: 'image/jpeg',
      // A photo of a buyer's item, perhaps of their home: no shared cache.
      cacheControl: 'private, no-store',
    })
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      await finish(deps, photo, { status: 'failed', reason: error.message })
      return
    }
    if (lastAttempt) {
      console.error(`Giving up on return photo ${photo.id}`, error)
      await finish(deps, photo, { status: 'failed', reason: GIVE_UP })
      return
    }
    throw error
  }
  await finish(deps, photo, { status: 'ready', prepared })
}

export async function registerReturnJobs(
  boss: PgBoss,
  deps: ReturnJobDependencies,
): Promise<void> {
  await boss.work(
    CHECK_RETURN_PHOTO_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { photoId } = checkReturnPhotoJob.parse(job.data)
      await checkUploadedReturnPhoto(deps, photoId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
}
