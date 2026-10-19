import { describe, expect, test } from 'vitest'
import { imageAddressForAi } from './images.ts'

/** A photo at `url` whose bytes are `bytes`, and the reads of it. */
const photo = (url: string, bytes: Buffer | null = Buffer.from('webp')) => {
  const reads: string[] = []
  return {
    reads,
    image: {
      url,
      contentType: 'image/webp',
      read: async () => {
        reads.push(url)
        return bytes
      },
    },
  }
}

describe('imageAddressForAi', () => {
  test('sends a photo on CloudFront as its address', async () => {
    const { image, reads } = photo('https://d1.cloudfront.net/images/a/card')
    expect(await imageAddressForAi(image, 'openrouter')).toBe(image.url)
    expect(reads).toEqual([])
  })

  test('sends a local photo inline to a remote provider', async () => {
    const { image } = photo('http://localhost:8333/ecokart/images/a/card')
    expect(await imageAddressForAi(image, 'openrouter')).toBe(
      `data:image/webp;base64,${Buffer.from('webp').toString('base64')}`,
    )
  })

  test('sends a local photo as its address to a local provider', async () => {
    const { image, reads } = photo('http://127.0.0.1:8333/ecokart/images/a')
    expect(await imageAddressForAi(image, 'local')).toBe(image.url)
    expect(reads).toEqual([])
  })

  test('gives nothing for a local photo whose file is missing', async () => {
    const { image } = photo('http://localhost:8333/ecokart/images/a', null)
    expect(await imageAddressForAi(image, 'openrouter')).toBeNull()
  })
})
