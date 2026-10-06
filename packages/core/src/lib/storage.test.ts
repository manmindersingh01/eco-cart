import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  createObjectStorage,
  loadStorageConfig,
  type UploadForm,
} from './storage.ts'

/*
 * Runs against the test bucket on the compose.yaml storage service (or CI's),
 * so the upload limits are checked by real object storage, not by our code.
 */

const storage = createObjectStorage(loadStorageConfig())

/** Posts a file with the form, the way a browser does. */
async function post(
  form: UploadForm,
  bytes: Buffer,
  override: Record<string, string> = {},
): Promise<number> {
  const body = new FormData()
  for (const [name, value] of Object.entries({ ...form.fields, ...override })) {
    body.append(name, value)
  }
  body.append('file', new Blob([bytes]))
  const response = await fetch(form.url, { method: 'POST', body })
  await response.arrayBuffer()
  return response.status
}

const uploadKey = () => `uploads/test/${randomUUID()}`
const formFor = (key: string, maxBytes = 1000) =>
  storage.createUploadForm(key, {
    contentType: 'image/jpeg',
    maxBytes,
    expiresInSeconds: 60,
  })

describe('upload forms', () => {
  test('let a browser upload a file within the limit', async () => {
    const key = uploadKey()
    expect(await post(await formFor(key), Buffer.from('photo'))).toBe(204)
    expect(await storage.read(key)).toEqual(Buffer.from('photo'))
  })

  test('are refused by storage for a larger file, another key, or another type', async () => {
    const key = uploadKey()
    expect(await post(await formFor(key, 4), Buffer.from('photo'))).toBe(400)
    expect(
      await post(await formFor(key), Buffer.from('photo'), {
        key: 'images/not-mine.webp',
      }),
    ).toBe(403)
    expect(
      await post(await formFor(key), Buffer.from('photo'), {
        'Content-Type': 'text/html',
      }),
    ).toBe(403)
    expect(await storage.read(key)).toBeNull()
    expect(await storage.read('images/not-mine.webp')).toBeNull()
  })
})

describe('objects', () => {
  test('are written, read, and removed', async () => {
    const key = `originals/${randomUUID()}`
    await storage.write(key, Buffer.from('original'), {
      contentType: 'image/jpeg',
    })
    expect(await storage.read(key)).toEqual(Buffer.from('original'))
    await storage.remove(key)
    expect(await storage.read(key)).toBeNull()
    // Removing again is not an error.
    await storage.remove(key)
  })

  test('only images/... can be read without signing in', async () => {
    const id = randomUUID()
    await storage.write(`images/${id}/card.webp`, Buffer.from('card'), {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    })
    await storage.write(`originals/${id}`, Buffer.from('original'), {
      contentType: 'image/jpeg',
    })

    const card = await fetch(storage.publicUrl(`images/${id}/card.webp`))
    expect(card.status).toBe(200)
    expect(card.headers.get('content-type')).toBe('image/webp')
    expect(card.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect((await fetch(storage.publicUrl(`originals/${id}`))).status).toBe(403)
  })
})

describe('loadStorageConfig', () => {
  const base = {
    STORAGE_BUCKET: 'ecokart-prod',
    STORAGE_REGION: 'ap-south-1',
    STORAGE_PUBLIC_URL: 'https://images.ecokart.example/',
  }

  test('uses the task role in production when no keys are set', () => {
    expect(loadStorageConfig({ NODE_ENV: 'production', ...base })).toEqual({
      bucket: 'ecokart-prod',
      region: 'ap-south-1',
      endpoint: undefined,
      credentials: undefined,
      publicUrl: 'https://images.ecokart.example',
    })
  })

  test('refuses half a key pair and the example secret in production', () => {
    expect(() =>
      loadStorageConfig({
        NODE_ENV: 'development',
        ...base,
        STORAGE_ACCESS_KEY_ID: 'ecokart',
      }),
    ).toThrow(
      'STORAGE_SECRET_ACCESS_KEY must be set together with STORAGE_ACCESS_KEY_ID, or neither',
    )
    expect(() =>
      loadStorageConfig({
        NODE_ENV: 'production',
        ...base,
        STORAGE_ACCESS_KEY_ID: 'ecokart',
        STORAGE_SECRET_ACCESS_KEY: 'development-only-storage-secret',
      }),
    ).toThrow('STORAGE_SECRET_ACCESS_KEY is the development example value')
  })
})
