import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { prepareLocalBucket } from '../lib/storage-setup.ts'
import { createS3Client, loadStorageConfig } from '../lib/storage.ts'

/**
 * Creates a package's test bucket if needed and empties it, so every test run
 * starts from nothing, like the test databases.
 */
export async function recreateTestBucket(
  env: Record<string, string>,
): Promise<void> {
  const config = loadStorageConfig({ NODE_ENV: 'test', ...env })
  const client = createS3Client(config)
  try {
    await prepareLocalBucket(config, ['http://localhost:3000'], client)
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
