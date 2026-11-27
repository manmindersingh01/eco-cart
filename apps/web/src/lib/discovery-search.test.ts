import { afterEach, expect, test, vi } from 'vitest'
import { MAX_SEARCH_PHOTO_BYTES } from '@ecokart/core'
import { SEARCH_PHOTO_TYPES } from '../../../../packages/core/src/modules/search/photos.ts'
import { ApiError } from './api-client'
import {
  checkSearchPhoto,
  discoveryProblem,
  discoveryRequest,
  maxSearchPhotoBytes,
  searchPhotoTypes,
  naturalHref,
  uploadSearchPhoto,
} from './discovery-search'

test('photo selection follows the existing server size and MIME contract', () => {
  expect(searchPhotoTypes).toEqual(SEARCH_PHOTO_TYPES)
  expect(maxSearchPhotoBytes).toBe(MAX_SEARCH_PHOTO_BYTES)
  expect(
    checkSearchPhoto({ type: 'image/jpeg', size: maxSearchPhotoBytes }),
  ).toBeNull()
  expect(checkSearchPhoto({ type: 'image/svg+xml', size: 100 })).toContain(
    'JPEG',
  )
  expect(
    checkSearchPhoto({ type: 'image/png', size: maxSearchPhotoBytes + 1 }),
  ).toContain('5 MB')
  expect(checkSearchPhoto({ type: 'image/png', size: 0 })).toContain('0 bytes')
})
test('discovery requests keep supported filters and exact cursors without sort or page mode', () => {
  const request = new URL(
    discoveryRequest('natural', {
      q: 'bottle under 500',
      minPricePaise: '1005',
      cursor: 'a+/=',
      limit: '2',
      sort: 'newest',
      mode: 'natural',
      photo: 'private-key',
    }),
    'https://example.test',
  )
  expect(Object.fromEntries(request.searchParams)).toEqual({
    q: 'bottle under 500',
    minPricePaise: '1005',
    cursor: 'a+/=',
    limit: '2',
  })
  expect(
    new URL(
      discoveryRequest('photo', {
        q: 'unused',
        photo: 'uploads/search/example',
      }),
      'https://example.test',
    ).searchParams.has('q'),
  ).toBe(false)
})
test('search errors explain fallback choices without exposing provider errors', () => {
  expect(
    discoveryProblem(
      new DOMException('PRIVATE_PROVIDER_DETAIL', 'TimeoutError'),
    ),
  ).toContain('timed out')
  expect(
    discoveryProblem(new ApiError('PRIVATE_PROVIDER_DETAIL', 503)),
  ).toContain('unavailable')
  expect(
    discoveryProblem(new ApiError('PRIVATE_PROVIDER_DETAIL', 429)),
  ).toContain('allowance')
  expect(discoveryProblem(new Error('PRIVATE_PROVIDER_DETAIL'))).not.toContain(
    'PRIVATE_PROVIDER_DETAIL',
  )
})

afterEach(() => vi.unstubAllGlobals())

test('natural navigation resets cursors for changed filters and retains explicit next-page cursors', () => {
  const values = {
    q: 'bottle',
    cursor: 'old',
    category: 'kitchen',
    minPricePaise: '1005',
    sort: 'newest',
    photo: 'private',
  }
  expect(
    new URL(
      naturalHref(values, { brand: 'brand' }),
      'https://example.test',
    ).searchParams.has('cursor'),
  ).toBe(false)
  const next = new URL(
    naturalHref(values, { cursor: 'a+/=' }),
    'https://example.test',
  ).searchParams
  expect(next.get('cursor')).toBe('a+/=')
  expect(next.get('category')).toBe('kitchen')
  expect(next.get('minPricePaise')).toBe('1005')
  expect(next.has('sort')).toBe(false)
  expect(next.has('photo')).toBe(false)
})
test('a photo goes directly to signed storage with the file last and no app credentials', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        upload: {
          key: 'private-key',
          url: 'https://storage.example.test',
          fields: { key: 'private-key', policy: 'signed' },
          maxBytes: 1024,
        },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', send)
  const file = new File(['photo'], 'photo.png', { type: 'image/png' })
  expect(await uploadSearchPhoto(file, new AbortController().signal)).toBe(
    'private-key',
  )
  expect(send.mock.calls[0]?.[0]).toBe('/api/search/photo/uploads')
  expect(send.mock.calls[0]?.[1]?.body).toBe(
    JSON.stringify({ contentType: 'image/png', size: 5 }),
  )
  expect(send.mock.calls[1]?.[0]).toBe('https://storage.example.test')
  expect(send.mock.calls[1]?.[1]?.credentials).toBe('omit')
  const body = send.mock.calls[1]?.[1]?.body
  expect(body).toBeInstanceOf(FormData)
  if (!(body instanceof FormData))
    throw new Error('Upload did not use FormData')
  expect([...body.keys()]).toEqual(['key', 'policy', 'file'])
})
test('refused storage uploads do not disclose the storage response', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          upload: {
            key: 'private-key',
            url: 'https://storage.example.test',
            fields: {},
            maxBytes: 1024,
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('PRIVATE_STORAGE_DETAIL', { status: 403 }),
      ),
  )
  await expect(
    uploadSearchPhoto(
      new File(['photo'], 'photo.png', { type: 'image/png' }),
      new AbortController().signal,
    ),
  ).rejects.toThrow('The photo upload failed. Choose the photo again to retry.')
})
