import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { prepareLocalBucket } from '../lib/storage-setup.ts'
import { createS3Client, loadStorageConfig } from '../lib/storage.ts'

/**
 * Creates a package's test bucket if needed and empties it, so every test run
 * starts from nothing, like the test databases.
 */
export async function recreateTestBucket(
  env: Record<string, string>,
  corsOrigins: string[] = ['http://localhost:3210'],
): Promise<void> {
  const config = loadStorageConfig({ NODE_ENV: 'test', ...env })
  const client = createS3Client(config)
  try {
    await prepareLocalBucket(config, corsOrigins, client)
    let token: string | undefined
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          ContinuationToken: token,
        }),
      )
      const keys = (page.Contents ?? []).flatMap((object) =>
        object.Key ? [{ Key: object.Key }] : [],
      )
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: keys },
          }),
        )
      }
      token = page.NextContinuationToken
    } while (token)
  } finally {
    client.destroy()
  }
}

/** Deletes only disposable test buckets, after their users have stopped. */
export async function deleteTestBucket(
  env: Record<string, string>,
): Promise<void> {
  const config = loadStorageConfig({ NODE_ENV: 'test', ...env })
  if (!config.bucket.startsWith('ecokart-test-')) {
    throw new Error('Refusing to delete a bucket outside the test namespace')
  }
  const client = createS3Client(config)
  try {
    // Always read from the start again after deletion; continuation tokens can
    // point past keys when the storage service compacts the previous page.
    for (;;) {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: config.bucket }),
      )
      const keys = (page.Contents ?? []).flatMap((object) =>
        object.Key ? [{ Key: object.Key }] : [],
      )
      if (keys.length === 0) break
      const removed = await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: keys },
        }),
      )
      if (removed.Errors?.length) throw new Error('Test bucket cleanup failed')
    }
    await client.send(new DeleteBucketCommand({ Bucket: config.bucket }))
  } catch (error) {
    if (!(error instanceof Error && error.name === 'NoSuchBucket')) throw error
  } finally {
    client.destroy()
  }
}
