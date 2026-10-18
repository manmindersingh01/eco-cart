import { IMAGE_SIZES } from '@ecokart/core'
import { describe, expect, test } from 'vitest'
import { PHOTO_SIZES, photoSource, productPhotoLoader } from './product-photos'

const base = 'https://images.ecokart.test/images/3f9a2c'
const load = (width: number) =>
  productPhotoLoader({ src: base, width, quality: 75 })

describe('product photo loader', () => {
  test('picks the smallest stored size at least as wide as asked', () => {
    expect(load(64)).toBe(`${base}/thumb.webp`)
    expect(load(160)).toBe(`${base}/thumb.webp`)
    expect(load(256)).toBe(`${base}/card.webp`)
    expect(load(480)).toBe(`${base}/card.webp`)
    expect(load(828)).toBe(`${base}/gallery.webp`)
    // Wider screens get the largest stored size; nothing is enlarged.
    expect(load(3840)).toBe(`${base}/gallery.webp`)
  })

  test('takes the address of a photo from the API', () => {
    expect(photoSource({ urls: { gallery: `${base}/gallery.webp` } })).toBe(
      base,
    )
  })

  test('knows the same sizes the worker makes', () => {
    expect(Object.fromEntries(PHOTO_SIZES)).toEqual(IMAGE_SIZES)
  })
})
