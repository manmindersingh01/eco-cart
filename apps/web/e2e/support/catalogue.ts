import { z } from 'zod'
import type { Page } from '@playwright/test'
import { expect } from './test.ts'

export const productShape = z.object({
  id: z.string(),
  slug: z.string(),
  minOrderQuantity: z.number(),
  status: z.string(),
  description: z.string(),
  images: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      urls: z.object({ thumb: z.string() }).nullable(),
    }),
  ),
  video: z
    .object({
      id: z.string(),
      status: z.string(),
      urls: z.object({ video: z.string() }).nullable(),
    })
    .nullable(),
})
export async function ownProduct(page: Page, id: string) {
  const response = await page.request.get(`/api/seller/products/${id}`, {
    maxRetries: 2,
  })
  expect(response.status()).toBe(200)
  return z.object({ product: productShape }).parse(await response.json())
    .product
}
export async function createCatalogueProduct(page: Page, categoryId: string) {
  const response = await page.request.post('/api/seller/products', {
    data: {
      categoryId,
      title: `Catalogue bowl ${crypto.randomUUID().slice(0, 8)}`,
      description: 'A reusable bamboo bowl for everyday use.',
      minOrderQuantity: 10,
      variants: [
        {
          sku: `CAT-${crypto.randomUUID()}`,
          pricePaise: 10000,
          mrpPaise: 12000,
          stock: 20,
        },
      ],
    },
  })
  expect(response.status()).toBe(201)
  return z.object({ product: productShape }).parse(await response.json())
    .product
}
export async function confirmAction(
  page: Page,
  label: string,
  title = label + '?',
) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page
    .getByRole('dialog', { name: title, exact: true })
    .getByRole('button', { name: label, exact: true })
    .click()
}
