import { randomInt } from 'node:crypto'
import { afterAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { getStorage } from '@/lib/storage'
import { GET as searchByPhoto } from './route'
import { POST as uploadForm } from './uploads/route'

/*
 * Search by photo through the API (backend spec step 18). The web tests run
 * with AI off, as development does; the search itself is tested in the core
 * package against the fake AI server.
 */

afterAll(async () => {
  await closePool()
})

const headers = () => ({
  'content-type': 'application/json',
  'x-forwarded-for': `198.20.${randomInt(256)}.${randomInt(256)}`,
})

describe('POST /api/search/photo/uploads and GET /api/search/photo', () => {
  test('signs a form for one photo, and the photo arrives in storage', async () => {
    const response = await uploadForm(
      new Request('http://localhost:3000/api/search/photo/uploads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ contentType: 'image/jpeg', size: 6 }),
      }),
    )
    expect(response.status).toBe(201)
    const { upload } = z
      .object({
        upload: z
          .object({
            key: z.string(),
            url: z.string(),
            fields: z.record(z.string(), z.string()),
          })
          .loose(),
      })
      .parse(await response.json())
    expect(upload).toMatchObject({
      key: expect.stringMatching(/^uploads\/search\/[0-9a-f-]{36}$/),
      maxBytes: 5 * 1024 * 1024,
    })

    const form = new FormData()
    for (const [name, value] of Object.entries(upload.fields)) {
      form.append(name, value)
    }
    form.append(
      'file',
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], {
        type: 'image/jpeg',
      }),
    )
    const posted = await fetch(upload.url, { method: 'POST', body: form })
    expect(posted.ok).toBe(true)
    expect(await getStorage().read(upload.key)).toHaveLength(6)
  })

  test('refuses a file that is not a photo, or too large', async () => {
    const response = await uploadForm(
      new Request('http://localhost:3000/api/search/photo/uploads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ contentType: 'application/pdf', size: 6 }),
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'That photo cannot be used',
      issues: ['contentType must be image/jpeg, image/png, or image/webp'],
    })
  })

  test('answers 503 while AI is off', async () => {
    const response = await searchByPhoto(
      new Request(
        `http://localhost:3000/api/search/photo?photo=uploads/search/${crypto.randomUUID()}`,
        { headers: headers() },
      ),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Search by photo is switched off',
    })
  })
})
