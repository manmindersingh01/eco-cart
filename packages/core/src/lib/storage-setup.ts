import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { requireEnv } from '../env.ts'
import {
  createS3Client,
  loadStorageConfig,
  type StorageConfig,
} from './storage.ts'

/*
 * Sets up a local bucket the way the infrastructure code will set up the
 * production one: browsers on `corsOrigins` may post uploads, and anyone may
 * read `images/...`, which CloudFront serves in production. Run by
 * `pnpm db:up` and by the test setup; never in production.
 */

const isAlreadyThere = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'BucketAlreadyOwnedByYou' ||
    error.name === 'BucketAlreadyExists')

export async function prepareLocalBucket(
  config: StorageConfig,
  corsOrigins: string[],
  client: S3Client = createS3Client(config),
): Promise<void> {
  const Bucket = config.bucket
  try {
    await client.send(new CreateBucketCommand({ Bucket }))
  } catch (error) {
    if (!isAlreadyThere(error)) throw error
  }
  await client.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: corsOrigins,
            AllowedMethods: ['POST'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  )
  await client.send(
    new PutBucketPolicyCommand({
      Bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicProductPhotos',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${Bucket}/images/*`],
          },
        ],
      }),
    }),
  )
}

if (import.meta.main) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'The local bucket setup never runs in production; the infrastructure code sets up S3',
    )
    process.exitCode = 1
  } else {
    const config = loadStorageConfig()
    const origins = requireEnv('STORAGE_CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
    try {
      await prepareLocalBucket(config, origins)
      console.info(
        `Storage: bucket ${config.bucket} is ready; photos load from ${config.publicUrl}/images/...`,
      )
    } catch (error) {
      console.error('Setting up the local bucket failed', error)
      process.exitCode = 1
    }
  }
}
