import {
  createDatabase,
  createObjectStorage,
  createPool,
  loadStorageConfig,
  requireEnv,
  schema,
} from '@ecokart/core'
import {
  createTestCategory,
  createTestSeller,
  createTestUser,
} from '@ecokart/core/testing'
import { processUploadedImage } from '@ecokart/core/worker'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as addImage } from './[id]/images/route'
import {
  DELETE as removeImage,
  PATCH as patchImage,
} from './[id]/images/[imageId]/route'
import { PUT as orderImages } from './[id]/images/order/route'
import { POST as requestUpload } from './[id]/images/uploads/route'
import {
  DELETE as deleteProduct,
  GET as getProduct,
  PATCH as patchProduct,
} from './[id]/route'
import { POST as addVariant } from './[id]/variants/route'
import {
  DELETE as deleteVariant,
  PATCH as patchVariant,
} from './[id]/variants/[variantId]/route'
import { POST as create, GET as list } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'products-route-test',
)
const owner = createDatabase(ownerPool)
const storage = createObjectStorage(loadStorageConfig())

let sellerCookie: string
let otherSellerCookie: string
let buyerCookie: string
let adminCookie: string
let categoryId: string

beforeAll(async () => {
  const [seller, other, admin] = await Promise.all([
    createTestSeller(owner),
    createTestSeller(owner),
    createTestUser(owner, 'admin'),
  ])
  sellerCookie = await signInWithEmail(owner, seller.owner.email)
  otherSellerCookie = await signInWithEmail(owner, other.owner.email)
  buyerCookie = await signInWithEmail(
    owner,
    `${crypto.randomUUID()}@example.test`,
  )
  adminCookie = await signInWithEmail(owner, admin.email)
  categoryId = (await createTestCategory(owner)).id
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const params = <T extends Record<string, string>>(values: T) => ({
  params: Promise.resolve(values),
})

const productResponse = z.object({
  product: z
    .object({
      id: z.string(),
      totalStock: z.number(),
      variants: z.array(z.object({ id: z.string(), sku: z.string() }).loose()),
      images: z.array(
        z
          .object({
            id: z.string(),
            status: z.string(),
            urls: z.record(z.string(), z.string()).nullable(),
          })
          .loose(),
      ),
    })
    .loose(),
})

const toothbrush = () => ({
  categoryId,
  title: 'Bamboo Toothbrush, Pack of 4',
  optionNames: ['Bristles'],
  variants: [
    {
      sku: 'BTB-SOFT',
      options: { Bristles: 'Soft' },
      pricePaise: 19_900,
      mrpPaise: 24_900,
      stock: 120,
    },
  ],
})

async function createVia(cookie = sellerCookie, body: unknown = toothbrush()) {
  return create(request('/seller/products', { method: 'POST', cookie, body }))
}

async function created() {
  const response = await createVia()
  expect(response.status).toBe(201)
  return productResponse.parse(await response.json()).product
}

describe('a listing through the API', () => {
  test('create, list, edit, add a variant, restock, and delete', async () => {
    const product = await created()
    const id = { id: product.id }

    const page = z
      .object({ items: z.array(z.object({ id: z.string() }).loose()) })
      .parse(
        await (
          await list(
            request('/seller/products?status=draft', { cookie: sellerCookie }),
          )
        ).json(),
      )
    expect(page.items.map((item) => item.id)).toContain(product.id)

    const edited = await patchProduct(
      request(`/seller/products/${product.id}`, {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { description: 'Biodegradable handles.' },
      }),
      params(id),
    )
    expect(edited.status).toBe(200)

    const withMedium = await addVariant(
      request(`/seller/products/${product.id}/variants`, {
        method: 'POST',
        cookie: sellerCookie,
        body: {
          sku: 'BTB-MED',
          options: { Bristles: 'Medium' },
          pricePaise: 18_900,
          mrpPaise: 22_900,
          stock: 80,
        },
      }),
      params(id),
    )
    expect(withMedium.status).toBe(201)
    const medium = productResponse
      .parse(await withMedium.json())
      .product.variants.find((variant) => variant.sku === 'BTB-MED')!

    const restocked = await patchVariant(
      request(`/seller/products/${product.id}/variants/${medium.id}`, {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { stock: 30 },
      }),
      params({ ...id, variantId: medium.id }),
    )
    expect(
      productResponse.parse(await restocked.json()).product.totalStock,
    ).toBe(150)

    const withoutMedium = await deleteVariant(
      request(`/seller/products/${product.id}/variants/${medium.id}`, {
        method: 'DELETE',
        cookie: sellerCookie,
      }),
      params({ ...id, variantId: medium.id }),
    )
    expect(
      productResponse.parse(await withoutMedium.json()).product.totalStock,
    ).toBe(120)

    const deleted = await deleteProduct(
      request(`/seller/products/${product.id}`, {
        method: 'DELETE',
        cookie: sellerCookie,
      }),
      params(id),
    )
    expect(deleted.status).toBe(204)
    expect(
      (
        await getProduct(
          request(`/seller/products/${product.id}`, { cookie: sellerCookie }),
          params(id),
        )
      ).status,
    ).toBe(404)
  })

  test('upload a photo, have it processed, order it, describe it, and remove it', async () => {
    const product = await created()
    const id = { id: product.id }

    const asked = await requestUpload(
      request(`/seller/products/${product.id}/images/uploads`, {
        method: 'POST',
        cookie: sellerCookie,
        body: { contentType: 'image/jpeg', size: 100_000 },
      }),
      params(id),
    )
    expect(asked.status).toBe(201)
    const { upload } = z
      .object({
        upload: z.object({
          key: z.string(),
          url: z.string(),
          fields: z.record(z.string(), z.string()),
        }),
      })
      .parse(await asked.json())

    // The browser posts the file straight to object storage.
    const body = new FormData()
    for (const [name, value] of Object.entries(upload.fields))
      body.append(name, value)
    const photo = await sharp({
      create: { width: 1000, height: 800, channels: 3, background: '#2e7d4f' },
    })
      .jpeg()
      .toBuffer()
    body.append('file', new Blob([photo]))
    expect((await fetch(upload.url, { method: 'POST', body })).status).toBe(204)

    const added = await addImage(
      request(`/seller/products/${product.id}/images`, {
        method: 'POST',
        cookie: sellerCookie,
        body: { uploadKey: upload.key },
      }),
      params(id),
    )
    expect(added.status).toBe(202)
    const imageId = productResponse.parse(await added.json()).product.images[0]!
      .id

    // What the worker does when it takes the job.
    await processUploadedImage({ db: owner, storage }, imageId)

    const shown = productResponse.parse(
      await (
        await getProduct(
          request(`/seller/products/${product.id}`, { cookie: sellerCookie }),
          params(id),
        )
      ).json(),
    ).product.images[0]!
    expect(shown.status).toBe('ready')
    expect((await fetch(shown.urls!.card!)).status).toBe(200)

    const ordered = await orderImages(
      request(`/seller/products/${product.id}/images/order`, {
        method: 'PUT',
        cookie: sellerCookie,
        body: { imageIds: [imageId] },
      }),
      params(id),
    )
    expect(ordered.status).toBe(200)
    const described = await patchImage(
      request(`/seller/products/${product.id}/images/${imageId}`, {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { alt: 'Green toothbrush handles' },
      }),
      params({ ...id, imageId }),
    )
    expect(described.status).toBe(200)
    const removed = await removeImage(
      request(`/seller/products/${product.id}/images/${imageId}`, {
        method: 'DELETE',
        cookie: sellerCookie,
      }),
      params({ ...id, imageId }),
    )
    expect(productResponse.parse(await removed.json()).product.images).toEqual(
      [],
    )
  })
})

describe('refusals', () => {
  test('401 signed out, 403 for a buyer or an administrator', async () => {
    expect((await list(request('/seller/products'))).status).toBe(401)
    expect((await createVia(buyerCookie)).status).toBe(403)
    expect((await createVia(adminCookie)).status).toBe(403)
  })

  test("404 for another seller's product", async () => {
    const product = await created()
    const response = await patchProduct(
      request(`/seller/products/${product.id}`, {
        method: 'PATCH',
        cookie: otherSellerCookie,
        body: { title: 'Taken over' },
      }),
      params({ id: product.id }),
    )
    expect(response.status).toBe(404)
  })

  test('400 with reasons for invalid details', async () => {
    const response = await createVia(sellerCookie, {
      ...toothbrush(),
      variants: [{ ...toothbrush().variants[0], mrpPaise: 100 }],
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those product details are not valid',
      issues: ['variants.0.mrpPaise must be at least pricePaise'],
    })
  })

  test('409 for a listing change while under review', async () => {
    const product = await created()
    // Under review is reached in step 7; set it directly here.
    await owner
      .update(schema.products)
      .set({ status: 'pending_review' })
      .where(eq(schema.products.id, product.id))
    const response = await patchProduct(
      request(`/seller/products/${product.id}`, {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { title: 'New title' },
      }),
      params({ id: product.id }),
    )
    expect(response.status).toBe(409)
  })
})
