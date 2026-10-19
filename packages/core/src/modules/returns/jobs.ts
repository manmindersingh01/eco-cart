import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
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
  DELETE_UNSENT_PHOTOS_QUEUE,
  returnPhotoStorageKey,
} from './photos.ts'
import { DELETE_UNSENT_PHOTO_AFTER_HOURS } from './types.ts'

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

/** Photos one round deletes; a run keeps going until none are left. */
const DELETE_BATCH = 200

/**
 * Deletes the photos buyers added but never sent with a return, once they
 * are DELETE_UNSENT_PHOTO_AFTER_HOURS old: first the checked copy, then the
 * row. By then `attachReturnPhotos` refuses them, so no return can start
 * pointing at a file this deletes. A file that cannot be deleted throws
 * before its row goes, so the retry, or the next night, tries again.
 * Returns how many photos it deleted.
 */
export async function deleteUnsentReturnPhotos(
  deps: ReturnJobDependencies,
): Promise<number> {
  let deleted = 0
  for (;;) {
    const batch = await deps.db
      .select({ id: returnPhotos.id })
      .from(returnPhotos)
      .where(
        and(
          isNull(returnPhotos.returnRequestId),
          lt(
            returnPhotos.createdAt,
            sql`now() - make_interval(hours => ${DELETE_UNSENT_PHOTO_AFTER_HOURS})`,
          ),
        ),
      )
      .orderBy(asc(returnPhotos.createdAt), asc(returnPhotos.id))
      .limit(DELETE_BATCH)
    if (batch.length === 0) return deleted
    // Every photo, not only ready ones: a check that ran late may have
    // written a copy after the photo was marked failed. Deleting a file
    // that is not there succeeds.
    for (const { id } of batch) {
      await deps.storage.remove(returnPhotoStorageKey(id))
    }
    const removed = await deps.db
      .delete(returnPhotos)
      .where(
        and(
          inArray(
            returnPhotos.id,
            batch.map(({ id }) => id),
          ),
          isNull(returnPhotos.returnRequestId),
        ),
      )
      .returning({ id: returnPhotos.id })
    deleted += removed.length
    if (batch.length < DELETE_BATCH) return deleted
  }
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
  // Every night at 03:45 India time; a night the worker was down gets one
  // run when it starts again.
  await boss.schedule(DELETE_UNSENT_PHOTOS_QUEUE, '45 3 * * *', null, {
    tz: 'Asia/Kolkata',
    missed: 'once',
  })
  await boss.work(DELETE_UNSENT_PHOTOS_QUEUE, async () => {
    const deleted = await deleteUnsentReturnPhotos(deps)
    if (deleted > 0) console.info(`Deleted unsent return photos: ${deleted}`)
  })
}
