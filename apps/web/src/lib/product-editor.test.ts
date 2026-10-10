import { describe, expect, test } from 'vitest'
import {
  canEditListing,
  movedImageIds,
  nextPollDelay,
  serialiseVariantChanges,
  shouldPollImages,
  signedUploadBody,
  validateImageFile,
  type ProductImage,
  type VariantEditValues,
} from './product-editor'

const variant: VariantEditValues = {
  sku: 'BOX-GREEN',
  optionValues: ['Green'],
  priceRupees: '199.95',
  mrpRupees: '249',
  stock: '12',
  isActive: true,
}

const image = (id: string, status: ProductImage['status']): ProductImage => ({
  id,
  status,
  alt: '',
  sortOrder: 0,
  variantId: null,
  width: null,
  height: null,
  failureReason: null,
  urls: null,
})

describe('product edit permissions and variants', () => {
  test('allows listing identity only for draft and rejected products', () => {
    expect(canEditListing('draft')).toBe(true)
    expect(canEditListing('rejected')).toBe(true)
    expect(canEditListing('pending_review')).toBe(false)
    expect(canEditListing('approved')).toBe(false)
    expect(canEditListing('archived')).toBe(false)
  })

  test('sends only changed commercial values when identity is locked', () => {
    expect(
      serialiseVariantChanges(
        variant,
        { ...variant, sku: 'IGNORED', stock: '15' },
        ['Colour'],
        false,
      ),
    ).toEqual({ ok: true, value: { stock: 15 } })
  })

  test('converts changed rupee values exactly and includes identity for drafts', () => {
    expect(
      serialiseVariantChanges(
        variant,
        {
          ...variant,
          sku: 'BOX-BLUE',
          optionValues: ['Blue'],
          priceRupees: '200.05',
        },
        ['Colour'],
        true,
      ),
    ).toEqual({
      ok: true,
      value: {
        sku: 'BOX-BLUE',
        options: { Colour: 'Blue' },
        pricePaise: 20_005,
      },
    })
  })
})

describe('photo upload and polling helpers', () => {
  test('rejects unsupported and oversized files before upload', () => {
    expect(validateImageFile({ type: 'image/svg+xml', size: 100 })).toContain(
      'JPEG',
    )
    expect(
      validateImageFile({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }),
    ).toContain('10 MB')
    expect(validateImageFile({ type: 'image/avif', size: 100 })).toBeNull()
  })

  test('puts every signed field before the file', () => {
    const body = signedUploadBody(
      { key: 'uploads/product/id', policy: 'signed' },
      new Blob(['photo']),
    )
    expect([...body.keys()]).toEqual(['key', 'policy', 'file'])
  })

  test('polls only for visible processing images with capped delays', () => {
    expect(shouldPollImages([image('one', 'processing')], true)).toBe(true)
    expect(shouldPollImages([image('one', 'processing')], false)).toBe(false)
    expect(shouldPollImages([image('one', 'ready')], true)).toBe(false)
    expect(nextPollDelay(0)).toBe(1_000)
    expect(nextPollDelay(9)).toBe(5_000)
  })

  test('reorders every current image id by one position', () => {
    const images = [
      image('one', 'ready'),
      image('two', 'failed'),
      image('three', 'ready'),
    ]
    expect(movedImageIds(images, 1, -1)).toEqual(['two', 'one', 'three'])
    expect(movedImageIds(images, 1, 1)).toEqual(['one', 'three', 'two'])
    expect(movedImageIds(images, 0, -1)).toEqual(['one', 'two', 'three'])
  })
})
