import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { SimilarProducts } from './similar-products'
import { readSimilarProducts } from '@/lib/storefront'

vi.mock('@/lib/storefront', () => ({
  readSimilarProducts: vi.fn<typeof readSimilarProducts>(),
}))

test('an empty suggestion list has a quiet fallback', async () => {
  vi.mocked(readSimilarProducts).mockResolvedValueOnce({
    productId: 'product',
    categoryId: 'category',
    items: [],
  })
  expect(
    renderToStaticMarkup(await SimilarProducts({ slug: 'product' })),
  ).toContain('No similar products to show yet.')
})
test('suggestion failures stay inside the optional section', async () => {
  vi.mocked(readSimilarProducts).mockRejectedValueOnce(
    new Error('PRIVATE_SERVICE_ERROR'),
  )
  const html = renderToStaticMarkup(await SimilarProducts({ slug: 'product' }))
  expect(html).toContain('You can still shop this product.')
  expect(html).not.toContain('PRIVATE_SERVICE_ERROR')
})
