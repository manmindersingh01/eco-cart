import { expect, test, vi, afterEach } from 'vitest'
import {
  minimumQuantity,
  mappingInput,
  uploadCatalogueFile,
  type UploadForm,
} from './catalogue-operations'
import { serialiseProduct } from './seller-products'
import { serialiseListingChanges } from './product-editor'

afterEach(() => vi.unstubAllGlobals())
test('C01 C02 minimum boundaries and creation payload retain the value', () => {
  for (const value of ['1', '10', '1000'])
    expect(minimumQuantity(value)).toBe(Number(value))
  for (const value of ['', '0', '1001', '1.2', '-1', '1e2'])
    expect(() => minimumQuantity(value)).toThrow('whole number')
  expect(
    serialiseProduct({
      categoryId: 'category',
      brandId: '',
      title: 'Bamboo bowl',
      description: '',
      hsnCode: '',
      highlights: [],
      attributes: [],
      optionNames: [],
      minOrderQuantity: '10',
      variants: [
        {
          id: 'v',
          sku: 'BOWL',
          optionValues: [],
          priceRupees: '100',
          mrpRupees: '120',
          stock: '11',
          isActive: true,
        },
      ],
    }),
  ).toMatchObject({ ok: true, value: { minOrderQuantity: 10 } })
  const initial = {
    categoryId: 'category',
    brandId: '',
    title: 'Bamboo bowl',
    description: '',
    highlights: [],
    attributes: [],
    hsnCode: '',
    optionNames: [],
  }
  expect(
    serialiseListingChanges(initial, {
      ...initial,
      description: 'A useful bowl',
    }),
  ).toEqual({ ok: true, value: { description: 'A useful bowl' } })
})
test('C07 C08 mapping requires every required field once and removes ignored columns', () => {
  const fields = [
    { field: 'title' as const, label: 'Title', required: true, hint: '' },
    { field: 'sku' as const, label: 'SKU', required: true, hint: '' },
  ]
  expect(
    mappingInput({ Name: 'title', Code: 'sku', Extra: '' }, fields),
  ).toEqual({ Name: 'title', Code: 'sku' })
  expect(() => mappingInput({ Name: 'title' }, fields)).toThrow('SKU')
  expect(() =>
    mappingInput({ Name: 'title', Other: 'title', Code: 'sku' }, fields),
  ).toThrow('once')
})
test('C04 renews one refused storage form without replaying registration', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const sign = vi
    .fn<() => Promise<UploadForm>>()
    .mockResolvedValueOnce({
      key: 'old',
      url: 'http://storage.test',
      fields: {},
      maxBytes: 100,
    })
    .mockResolvedValueOnce({
      key: 'new',
      url: 'http://storage.test',
      fields: {},
      maxBytes: 100,
    })
  expect(
    await uploadCatalogueFile(new File(['video'], 'video.mp4'), sign),
  ).toBe('new')
  expect(sign).toHaveBeenCalledTimes(2)
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('does not retry ambiguous storage failures or exceed the server limit', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new Error('Connection lost'))
  vi.stubGlobal('fetch', fetch)
  const sign = vi.fn<() => Promise<UploadForm>>().mockResolvedValue({
    key: 'key',
    url: 'http://storage.test',
    fields: {},
    maxBytes: 10,
  })
  await expect(
    uploadCatalogueFile(new File(['video'], 'video.mp4'), sign),
  ).rejects.toThrow('Connection lost')
  expect(fetch).toHaveBeenCalledTimes(1)
  await expect(
    uploadCatalogueFile(new File(['too many bytes'], 'video.mp4'), sign),
  ).rejects.toThrow('server upload limit')
  expect(fetch).toHaveBeenCalledTimes(1)
})
