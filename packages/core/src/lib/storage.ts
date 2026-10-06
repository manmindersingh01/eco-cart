import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { z } from 'zod'
import { parseEnv, secretString } from './config.ts'

/*
 * Object storage (design doc 3.1, backend spec step 6): the private S3 bucket
 * in production and the SeaweedFS service from compose.yaml locally, through
 * one S3 client. Files go straight between the browser and the bucket; the
 * web app only signs the upload form.
 *
 * Keys are grouped by who may read them:
 * - images/...    public product photo sizes, served through CloudFront
 * - uploads/...   files as the browser sent them, read only by the worker
 * - originals/... private copies of accepted photos
 */

export interface StorageConfig {
  bucket: string
  region: string
  /** Set locally (SeaweedFS); left out in production, which uses AWS. */
  endpoint: string | undefined
  /** Left out in production, where the ECS task role signs requests. */
  credentials: { accessKeyId: string; secretAccessKey: string } | undefined
  /** Where `images/...` keys are served from: CloudFront in production. */
  publicUrl: string
}

export function loadStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig {
  const schema = z
    .object({
      STORAGE_BUCKET: z
        .string()
        .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a bucket name'),
      STORAGE_REGION: z.string().min(1, 'must not be empty'),
      STORAGE_ENDPOINT: z.url().optional(),
      STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
      STORAGE_SECRET_ACCESS_KEY: secretString(env, 16).optional(),
      STORAGE_PUBLIC_URL: z.url(),
    })
    .refine(
      (config) =>
        (config.STORAGE_ACCESS_KEY_ID === undefined) ===
        (config.STORAGE_SECRET_ACCESS_KEY === undefined),
      {
        path: ['STORAGE_SECRET_ACCESS_KEY'],
        message: 'must be set together with STORAGE_ACCESS_KEY_ID, or neither',
      },
    )
  const config = parseEnv(schema, env)
  return {
    bucket: config.STORAGE_BUCKET,
    region: config.STORAGE_REGION,
    endpoint: config.STORAGE_ENDPOINT,
    credentials:
      config.STORAGE_ACCESS_KEY_ID && config.STORAGE_SECRET_ACCESS_KEY
        ? {
            accessKeyId: config.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
          }
        : undefined,
    publicUrl: config.STORAGE_PUBLIC_URL.replace(/\/+$/, ''),
  }
}

export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint
      ? { endpoint: config.endpoint, forcePathStyle: true }
      : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
  })
}

/** A form the browser posts a file with, straight to object storage. */
export interface UploadForm {
  url: string
  fields: Record<string, string>
}

export interface ObjectStorage {
  /**
   * Signs a form for one upload to `key`. Storage itself refuses a larger
   * file, another key, or another content type, and the form expires.
   */
  createUploadForm(
    key: string,
    options: {
      contentType: string
      maxBytes: number
      expiresInSeconds: number
    },
  ): Promise<UploadForm>
  /** The object's bytes, or null when there is no such object. */
  read(key: string): Promise<Buffer | null>
  write(
    key: string,
    body: Buffer,
    options: { contentType: string; cacheControl?: string },
  ): Promise<void>
  /** Removes the object; nothing happens when it does not exist. */
  remove(key: string): Promise<void>
  /** The public address of an `images/...` key. */
  publicUrl(key: string): string
}

const isMissing = (error: unknown) =>
  error instanceof Error && error.name === 'NoSuchKey'

export function createObjectStorage(
  config: StorageConfig,
  client: S3Client = createS3Client(config),
): ObjectStorage {
  const Bucket = config.bucket
  return {
    async createUploadForm(key, { contentType, maxBytes, expiresInSeconds }) {
      return createPresignedPost(client, {
        Bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, maxBytes],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: expiresInSeconds,
      })
    },

    async read(key) {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket, Key: key }),
        )
        if (!object.Body) return null
        return Buffer.from(await object.Body.transformToByteArray())
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    async write(key, body, { contentType, cacheControl }) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(cacheControl ? { CacheControl: cacheControl } : {}),
        }),
      )
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },

    publicUrl: (key) => `${config.publicUrl}/${key}`,
  }
}
