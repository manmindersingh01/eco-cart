import { and, eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database, Transaction } from '../../db/client.ts'
import {
  sellerDocumentFiles,
  sellerDocumentRequests,
} from '../../db/schema/index.ts'
import {
  checkDocumentFile,
  DocumentRejectedError,
  type CheckedDocument,
} from '../../lib/document-files.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import {
  CHECK_DOCUMENT_QUEUE,
  checkDocumentJob,
  documentStorageKey,
} from './documents.ts'
import { MAX_DOCUMENT_BYTES } from './types.ts'

/*
 * The worker's seller jobs (design doc 5.4). Only the worker loads this file,
 * because it loads the image and PDF libraries.
 */

export interface SellerJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  storage: ObjectStorage
}

const GIVE_UP = 'The file could not be checked; upload it again'

type FileRow = typeof sellerDocumentFiles.$inferSelect

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

/** The request first, like every other change to it. */
async function lockRequest(tx: Transaction, requestId: string): Promise<void> {
  await tx
    .select({ id: sellerDocumentRequests.id })
    .from(sellerDocumentRequests)
    .where(eq(sellerDocumentRequests.id, requestId))
    .for('update')
}

/**
 * Records the file's outcome, and moves its request on only if the request
 * still waits for this check: a request cancelled in the meantime stays
 * cancelled.
 */
async function finish(
  deps: SellerJobDependencies,
  file: FileRow,
  outcome:
    | { status: 'received'; checked: CheckedDocument }
    | { status: 'failed'; reason: string },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await lockRequest(tx, file.requestId)
    const [changed] = await tx
      .update(sellerDocumentFiles)
      .set(
        outcome.status === 'received'
          ? {
              status: 'received',
              storageKey: documentStorageKey(file),
              contentType: outcome.checked.contentType,
              sizeBytes: outcome.checked.bytes.length,
              contentHash: outcome.checked.contentHash,
            }
          : { status: 'failed', failureReason: outcome.reason },
      )
      .where(
        and(
          eq(sellerDocumentFiles.id, file.id),
          eq(sellerDocumentFiles.status, 'processing'),
        ),
      )
      .returning({ id: sellerDocumentFiles.id })
    if (!changed) return
    await tx
      .update(sellerDocumentRequests)
      .set({
        // A failed file sends the request back to the seller.
        status: outcome.status === 'received' ? 'received' : 'requested',
      })
      .where(
        and(
          eq(sellerDocumentRequests.id, file.requestId),
          eq(sellerDocumentRequests.status, 'processing'),
        ),
      )
  })
  await removeUpload(deps.storage, file.uploadKey)
}

/**
 * Checks an uploaded verification document and keeps a clean private copy,
 * then marks the file received, or failed with a reason the seller sees.
 * Running twice does nothing more.
 *
 * Storage errors are thrown, so pg-boss retries; on the `lastAttempt` the
 * file is marked failed instead.
 */
export async function checkUploadedDocument(
  deps: SellerJobDependencies,
  fileId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [file] = await deps.db
    .select()
    .from(sellerDocumentFiles)
    .where(eq(sellerDocumentFiles.id, fileId))
  if (!file || file.status !== 'processing') return

  let checked: CheckedDocument
  try {
    const original = await deps.storage.read(file.uploadKey)
    if (!original) {
      await finish(deps, file, {
        status: 'failed',
        reason: 'The upload did not arrive; upload the file again',
      })
      return
    }
    if (original.length > MAX_DOCUMENT_BYTES) {
      await finish(deps, file, {
        status: 'failed',
        reason: 'The file is larger than 10 MB',
      })
      return
    }
    checked = await checkDocumentFile(original)
    await deps.storage.write(documentStorageKey(file), checked.bytes, {
      contentType: checked.contentType,
      // Identity and bank details: no shared cache may keep a copy.
      cacheControl: 'private, no-store',
    })
  } catch (error) {
    if (error instanceof DocumentRejectedError) {
      await finish(deps, file, { status: 'failed', reason: error.message })
      return
    }
    if (lastAttempt) {
      console.error(`Giving up on seller document file ${file.id}`, error)
      await finish(deps, file, { status: 'failed', reason: GIVE_UP })
      return
    }
    throw error
  }
  await finish(deps, file, { status: 'received', checked })
}

export async function registerSellerJobs(
  boss: PgBoss,
  deps: SellerJobDependencies,
): Promise<void> {
  await boss.work(
    CHECK_DOCUMENT_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { fileId } = checkDocumentJob.parse(job.data)
      await checkUploadedDocument(deps, fileId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
}
