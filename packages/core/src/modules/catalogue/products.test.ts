import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  products,
  productImages,
  productVariants,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestBrand,
  createTestCategory,
  createTestOrder,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import { updateBrand } from './brands.ts'
import { createCategory, updateCategory } from './categories.ts'
import {
  addVariant,
  createProduct,
  deleteProduct,
  deleteVariant,
  getOwnProduct,
  listOwnProducts,
  updateProduct,
  updateVariant,
  type SellerContext,
} from './products.ts'
import type { ProductView } from './types.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'products-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const photos = { publicUrl: (key: string) => `https://images.test/${key}` }

let admin: Extract<RequestContext, { role: 'admin' }>
let seller: SellerContext
let category: { id: string; name: string }

beforeAll(async () => {
  const adminUser = await createTestUser(owner, 'admin')
  admin = { role: 'admin', userId: adminUser.id }
  seller = await newSeller()
  category = await createTestCategory(owner)
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

async function newSeller(): Promise<SellerContext> {
  const { owner: user, seller: business } = await createTestSeller(owner)
  return { role: 'seller', userId: user.id, sellerId: business.id }
}

const as = <T>(
  context: RequestContext,
  work: (tx: Parameters<Parameters<typeof withContext>[2]>[0]) => Promise<T>,
) => withContext(web, context, work)

/** Two sizes of a bamboo toothbrush: Soft (₹199, 120) and Medium (₹189, 80). */
const toothbrush = (overrides: Record<string, unknown> = {}) => ({
  categoryId: category.id,
  title: 'Bamboo Toothbrush, Pack of 4',
  description: 'Biodegradable handles.',
  highlights: ['Charcoal bristles', 'Plastic-free box'],
  attributes: { material: 'bamboo' },
  optionNames: ['Bristles'],
  variants: [
    {
      sku: 'BTB-SOFT',
      options: { Bristles: 'Soft' },
      pricePaise: 19_900,
      mrpPaise: 24_900,
      stock: 120,
    },
    {
      sku: 'BTB-MED',
      options: { Bristles: 'Medium' },
      pricePaise: 18_900,
      mrpPaise: 22_900,
      stock: 80,
    },
  ],
  ...overrides,
})

const create = (input: unknown, context: RequestContext = seller) =>
  as(context, (tx) => createProduct(tx, photos, context, input))
const update = (id: string, input: unknown, context = seller) =>
  as(context, (tx) => updateProduct(tx, photos, context, id, input))
const changeVariant = (
  product: ProductView,
  index: number,
  input: unknown,
  context = seller,
) =>
  as(context, (tx) =>
    updateVariant(
      tx,
      photos,
      context,
      product.id,
      product.variants[index]!.id,
      input,
    ),
  )

const searchText = async (id: string) =>
  (
    await owner
      .select({ text: products.searchText })
      .from(products)
      .where(eq(products.id, id))
  )[0]!.text

/** Sets a status directly, for states that later steps reach. */
const setStatus = (id: string, status: string, publishedAt?: Date) =>
  owner
    .update(products)
    .set({ status, ...(publishedAt ? { publishedAt } : {}) })
    .where(eq(products.id, id))

describe('createProduct', () => {
  test('creates a draft with its variants and summary', async () => {
    const brand = await createTestBrand(owner)
    const product = await create(toothbrush({ brandId: brand.id }))

    expect(product).toMatchObject({
      status: 'draft',
      title: 'Bamboo Toothbrush, Pack of 4',
      slug: `bamboo-toothbrush-pack-of-4-${product.id.slice(0, 6)}`,
      optionNames: ['Bristles'],
      hsnCode: null,
      gstRateBps: null,
      category: {
        id: category.id,
        path: [category.name],
        gstRateBps: 1800,
        defaultHsnCode: '3924',
      },
      brand: { id: brand.id, name: brand.name },
      minPricePaise: 18_900,
      maxPricePaise: 19_900,
      minMrpPaise: 22_900,
      totalStock: 200,
      images: [],
    })
    expect(product.variants.map((v) => [v.sku, v.options, v.stock])).toEqual([
      ['BTB-SOFT', { Bristles: 'Soft' }, 120],
      ['BTB-MED', { Bristles: 'Medium' }, 80],
    ])
    expect(await searchText(product.id)).toBe(
      `Bamboo Toothbrush, Pack of 4 ${brand.name} ${category.name} Charcoal bristles Plastic-free box`,
    )
  })

  test('a product without options has exactly one variant', async () => {
    const single = await create(
      toothbrush({
        optionNames: undefined,
        variants: [
          { sku: 'JUTE-1', pricePaise: 34_900, mrpPaise: 34_900, stock: 0 },
        ],
      }),
    )
    expect(single.variants).toEqual([
      expect.objectContaining({ options: {}, stock: 0 }),
    ])
    expect(single.totalStock).toBe(0)

    expect(
      await validationIssues(
        create(
          toothbrush({
            optionNames: [],
            variants: [
              { sku: 'A', pricePaise: 100, mrpPaise: 100, stock: 1 },
              { sku: 'B', pricePaise: 100, mrpPaise: 100, stock: 1 },
            ],
          }),
        ),
      ),
    ).toEqual([
      'variants must have exactly one entry when there are no option names',
    ])
  })

  test('counts only active variants in the summary', async () => {
    const product = await create(
      toothbrush({
        variants: [
          {
            sku: 'A',
            options: { Bristles: 'Soft' },
            pricePaise: 100,
            mrpPaise: 150,
            stock: 3,
          },
          {
            sku: 'B',
            options: { Bristles: 'Hard' },
            pricePaise: 50,
            mrpPaise: 60,
            stock: 7,
            isActive: false,
          },
        ],
      }),
    )
    expect(product).toMatchObject({
      minPricePaise: 100,
      maxPricePaise: 100,
      minMrpPaise: 150,
      totalStock: 3,
    })
  })

  test('checks every variant against the option names and the others', async () => {
    expect(
      await validationIssues(
        create(
          toothbrush({
            optionNames: ['Bristles', 'bristles'],
            variants: [
              {
                sku: 'X-1',
                options: { Colour: 'Green' },
                pricePaise: 500,
                mrpPaise: 400,
                stock: 1,
              },
              {
                sku: 'x-1',
                options: {},
                pricePaise: 100,
                mrpPaise: 100,
                stock: 1,
              },
            ],
          }),
        ),
      ),
    ).toEqual([
      'optionNames must not repeat a name',
      'variants.0.options needs a value for Bristles',
      'variants.0.options needs a value for bristles',
      'variants.0.options has Colour, which is not one of the option names',
      'variants.0.mrpPaise must be at least pricePaise',
      'variants.1.options needs a value for Bristles',
      'variants.1.options needs a value for bristles',
      'variants.1.sku is already used by another variant',
      "variants.1.options are the same as another variant's",
    ])
    expect(
      await validationIssues(
        create(
          toothbrush({
            variants: [
              {
                sku: 'A',
                options: { Bristles: 'Soft' },
                pricePaise: 100,
                mrpPaise: 100,
                stock: 1,
              },
              {
                sku: 'B',
                options: { Bristles: 'SOFT' },
                pricePaise: 100,
                mrpPaise: 100,
                stock: 1,
              },
            ],
          }),
        ),
      ),
    ).toEqual(["variants.1.options are the same as another variant's"])
  })

  test('checks the fields themselves', async () => {
    expect(
      await validationIssues(
        create({
          ...toothbrush(),
          title: 'Hi',
          optionNames: ['A', 'B', 'C', 'D'],
          variants: [
            {
              sku: '-bad sku',
              options: { A: 'x' },
              pricePaise: 100_000_001,
              mrpPaise: 0,
              stock: -1,
            },
          ],
          colour: 'green',
        }),
      ),
    ).toEqual([
      'title must be at least 3 characters',
      'optionNames can have at most 3 names',
      'variants.0.sku must be 1 to 64 letters, digits, dots, hyphens, underscores, or slashes, starting with a letter or digit',
      'variants.0.pricePaise must be at most 100000000',
      'variants.0.mrpPaise must be at least 1',
      'variants.0.stock must be at least 0',
      'colour is not allowed here',
    ])
  })

  test('lists products only in an active category at the bottom of the tree', async () => {
    const parent = await as(admin, (tx) =>
      createCategory(tx, admin, {
        name: `Care ${randomUUID().slice(0, 8)}`,
        gstRateBps: 1800,
      }),
    )
    const child = await as(admin, (tx) =>
      createCategory(tx, admin, {
        name: 'Soaps',
        parentId: parent.id,
        gstRateBps: 500,
      }),
    )
    expect(
      await validationIssues(create(toothbrush({ categoryId: parent.id }))),
    ).toEqual(['categoryId has subcategories; choose the most specific one'])

    await as(admin, (tx) =>
      updateCategory(tx, admin, parent.id, { isActive: false }),
    )
    expect(
      await validationIssues(create(toothbrush({ categoryId: child.id }))),
    ).toEqual(['categoryId is not active'])
    expect(
      await validationIssues(create(toothbrush({ categoryId: randomUUID() }))),
    ).toEqual(['categoryId is not an existing category'])

    const inactiveBrand = await createTestBrand(owner, false)
    expect(
      await validationIssues(create(toothbrush({ brandId: inactiveBrand.id }))),
    ).toEqual(['brandId is not active'])
  })

  test.each<[string, RequestContext]>([
    ['an administrator', { role: 'admin', userId: randomUUID() }],
    ['a buyer', { role: 'buyer', userId: randomUUID() }],
    ['a visitor', { role: 'anonymous' }],
  ])('refuses %s', async (_who, context) => {
    await expect(create(toothbrush(), context)).rejects.toThrow(ForbiddenError)
  })
})

describe('reading products', () => {
  test("a seller never sees another seller's product", async () => {
    const product = await create(toothbrush())
    const other = await newSeller()
    await expect(
      as(other, (tx) => getOwnProduct(tx, photos, other, product.id)),
    ).rejects.toThrow(NotFoundError)
    await expect(
      update(product.id, { title: 'Mine now' }, other),
    ).rejects.toThrow(NotFoundError)
    // Row-level security hides the draft even from a query that forgets to check.
    const rows = await as(other, (tx) =>
      tx.select().from(products).where(eq(products.id, product.id)),
    )
    expect(rows).toEqual([])
  })

  test('lists own products newest first, by status, a page at a time', async () => {
    const me = await newSeller()
    const first = await create(toothbrush({ title: 'First listing' }), me)
    const second = await create(toothbrush({ title: 'Second listing' }), me)
    const third = await create(toothbrush({ title: 'Third listing' }), me)
    await setStatus(second.id, 'rejected')
    await as(me, (tx) => deleteProduct(tx, me, third.id))

    const page = await as(me, (tx) =>
      listOwnProducts(tx, photos, me, { limit: 1 }),
    )
    expect(page.items.map((item) => item.title)).toEqual(['Second listing'])
    const next = await as(me, (tx) =>
      listOwnProducts(tx, photos, me, { limit: 1, cursor: page.nextCursor! }),
    )
    expect(next).toMatchObject({
      items: [
        {
          id: first.id,
          status: 'draft',
          categoryName: category.name,
          totalStock: 200,
          thumbnailUrl: null,
        },
      ],
      nextCursor: null,
    })
    const drafts = await as(me, (tx) =>
      listOwnProducts(tx, photos, me, { status: 'draft' }),
    )
    expect(drafts.items.map((item) => item.id)).toEqual([first.id])
    await expect(
      as(me, (tx) => listOwnProducts(tx, photos, me, { status: 'live' })),
    ).rejects.toThrow(
      'status must be one of draft, pending_review, approved, rejected, archived',
    )
  })
})

describe('updateProduct', () => {
  test('changes listing details, and the address follows the title until published', async () => {
    const product = await create(toothbrush())
    const changed = await update(product.id, {
      title: 'Bamboo Toothbrush, Pack of 6',
      highlights: ['Six brushes'],
      hsnCode: '96032100',
    })
    expect(changed).toMatchObject({
      title: 'Bamboo Toothbrush, Pack of 6',
      slug: `bamboo-toothbrush-pack-of-6-${product.id.slice(0, 6)}`,
      hsnCode: '96032100',
    })
    expect(await searchText(product.id)).toContain('Six brushes')

    await setStatus(product.id, 'rejected', new Date())
    const renamed = await update(product.id, { title: 'Bamboo Brush Set' })
    expect(renamed.slug).toBe(changed.slug)
  })

  test('renames option names in every variant, but never adds or removes one', async () => {
    const product = await create(toothbrush())
    const renamed = await update(product.id, { optionNames: ['Bristle type'] })
    expect(renamed.variants.map((v) => v.options)).toEqual([
      { 'Bristle type': 'Soft' },
      { 'Bristle type': 'Medium' },
    ])
    expect(
      await validationIssues(
        update(product.id, { optionNames: ['Size', 'Colour'] }),
      ),
    ).toEqual([
      'optionNames can be renamed but not added or removed, so it needs 1 names',
    ])
  })

  test('refuses listing changes once the product is under review or on sale', async () => {
    const product = await create(toothbrush())
    for (const status of ['pending_review', 'approved', 'archived']) {
      await setStatus(product.id, status)
      await expect(update(product.id, { title: 'New title' })).rejects.toThrow(
        new ConflictError(
          'Listing details can change only while the product is a draft or after it was rejected',
        ),
      )
    }
  })

  test('refuses an empty change and a product that does not exist', async () => {
    const product = await create(toothbrush())
    await expect(update(product.id, {})).rejects.toThrow(
      'There is nothing to change',
    )
    await expect(update(randomUUID(), { title: 'Nothing' })).rejects.toThrow(
      NotFoundError,
    )
    await expect(update('not-an-id', { title: 'Nothing' })).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('the catalogue keeps search text and the tree in step', () => {
  test('renaming a category or brand rebuilds the search text of its products', async () => {
    const own = await as(admin, (tx) =>
      createCategory(tx, admin, {
        name: `Brushes ${randomUUID().slice(0, 8)}`,
        gstRateBps: 500,
      }),
    )
    const brand = await createTestBrand(owner)
    const product = await create(
      toothbrush({ categoryId: own.id, brandId: brand.id, highlights: [] }),
    )

    await as(admin, (tx) =>
      updateCategory(tx, admin, own.id, { name: 'Toothbrushes' }),
    )
    await as(admin, (tx) =>
      updateBrand(tx, admin, brand.id, { name: `Leaf ${brand.slug}` }),
    )

    expect(await searchText(product.id)).toBe(
      `Bamboo Toothbrush, Pack of 4 Leaf ${brand.slug} Toothbrushes`,
    )
  })

  test('a category with products cannot get subcategories', async () => {
    const own = await as(admin, (tx) =>
      createCategory(tx, admin, {
        name: `Bags ${randomUUID().slice(0, 8)}`,
        gstRateBps: 500,
      }),
    )
    await create(toothbrush({ categoryId: own.id }))
    expect(
      await validationIssues(
        as(admin, (tx) =>
          createCategory(tx, admin, {
            name: 'Jute',
            parentId: own.id,
            gstRateBps: 500,
          }),
        ),
      ),
    ).toEqual([
      'parentId has products listed in it, so it cannot have subcategories',
    ])
  })
})

describe('variants', () => {
  test('price, MRP, stock, and active change at any time, even on sale', async () => {
    const product = await create(toothbrush())
    await setStatus(product.id, 'approved', new Date())

    const restocked = await changeVariant(product, 0, { stock: 95 })
    expect(restocked.totalStock).toBe(175)
    const repriced = await changeVariant(product, 1, { pricePaise: 17_900 })
    expect(repriced.minPricePaise).toBe(17_900)
    const paused = await changeVariant(product, 1, { isActive: false })
    expect(paused).toMatchObject({
      totalStock: 95,
      minPricePaise: 19_900,
      maxPricePaise: 19_900,
    })
    // Sending the SKU it already has is not a listing change.
    await expect(
      changeVariant(product, 0, { sku: 'BTB-SOFT', stock: 90 }),
    ).resolves.toMatchObject({ totalStock: 90 })
    await expect(changeVariant(product, 0, { sku: 'BTB-S' })).rejects.toThrow(
      ConflictError,
    )
    expect(
      await validationIssues(changeVariant(product, 0, { mrpPaise: 100 })),
    ).toEqual(['variant.mrpPaise must be at least pricePaise'])
  })

  test('adds a variant to a draft, checked against the others', async () => {
    const product = await create(toothbrush())
    const added = await as(seller, (tx) =>
      addVariant(tx, photos, seller, product.id, {
        sku: 'BTB-HARD',
        options: { Bristles: 'Hard' },
        pricePaise: 20_900,
        mrpPaise: 24_900,
        stock: 10,
      }),
    )
    expect(added).toMatchObject({ maxPricePaise: 20_900, totalStock: 210 })
    expect(
      await validationIssues(
        as(seller, (tx) =>
          addVariant(tx, photos, seller, product.id, {
            sku: 'btb-hard',
            options: { Bristles: 'hard' },
            pricePaise: 100,
            mrpPaise: 100,
            stock: 1,
          }),
        ),
      ),
    ).toEqual([
      'variant.sku is already used by another variant',
      "variant.options are the same as another variant's",
    ])
  })

  test('deletes a variant, but never the last one or one that was ordered', async () => {
    const product = await create(toothbrush())
    const [soft, medium] = product.variants
    const left = await as(seller, (tx) =>
      deleteVariant(tx, photos, seller, product.id, medium!.id),
    )
    expect(left).toMatchObject({
      totalStock: 120,
      variants: [{ id: soft!.id }],
    })
    await expect(
      as(seller, (tx) =>
        deleteVariant(tx, photos, seller, product.id, soft!.id),
      ),
    ).rejects.toThrow(
      'A product needs at least one variant; delete the product instead',
    )

    const ordered = await create(toothbrush())
    const buyer = await createTestUser(owner, 'buyer')
    await createTestOrder(owner, {
      buyerId: buyer.id,
      lines: [
        {
          sellerId: seller.sellerId,
          productId: ordered.id,
          variantId: ordered.variants[0]!.id,
        },
      ],
    })
    await expect(
      as(seller, (tx) =>
        deleteVariant(tx, photos, seller, ordered.id, ordered.variants[0]!.id),
      ),
    ).rejects.toThrow(
      'This variant is in an order or a cart; deactivate it instead',
    )
  })

  test('a photo of a deleted variant stays as a photo of the product', async () => {
    const product = await create(toothbrush())
    const medium = product.variants[1]!
    const [photo] = await owner
      .insert(productImages)
      .values({
        productId: product.id,
        variantId: medium.id,
        storageKey: `images/${randomUUID()}`,
      })
      .returning()
    await as(seller, (tx) =>
      deleteVariant(tx, photos, seller, product.id, medium.id),
    )
    const [after] = await owner
      .select({ variantId: productImages.variantId })
      .from(productImages)
      .where(eq(productImages.id, photo!.id))
    expect(after).toEqual({ variantId: null })
  })

  test('two stock changes at the same moment both count in the total', async () => {
    const product = await create(toothbrush())
    // Both changes start while the product row is held, so they truly race.
    const { pid, release, finished } = await holdRows(
      owner,
      products,
      products.id,
      [product.id],
    )
    const changes = Promise.all([
      changeVariant(product, 0, { stock: 10 }),
      changeVariant(product, 1, { stock: 20 }),
    ])
    await waitUntil(async () => (await sessionsWaitingOn(owner, pid)) >= 2)
    release()
    await finished
    await changes

    const [row] = await owner
      .select({ totalStock: products.totalStock })
      .from(products)
      .where(eq(products.id, product.id))
    expect(row).toEqual({ totalStock: 30 })
    const [sum] = await owner
      .select({ stock: sql<number>`sum(${productVariants.stock})::int` })
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
    expect(sum).toEqual({ stock: 30 })
  })
})

describe('deleteProduct', () => {
  test('deletes a draft, which then disappears', async () => {
    const product = await create(toothbrush())
    await as(seller, (tx) => deleteProduct(tx, seller, product.id))
    await expect(
      as(seller, (tx) => getOwnProduct(tx, photos, seller, product.id)),
    ).rejects.toThrow(NotFoundError)
    const [row] = await owner
      .select({ deletedAt: products.deletedAt })
      .from(products)
      .where(eq(products.id, product.id))
    expect(row?.deletedAt).toBeInstanceOf(Date)
  })

  test('refuses a product that was on sale', async () => {
    const product = await create(toothbrush())
    await setStatus(product.id, 'approved', new Date())
    await expect(
      as(seller, (tx) => deleteProduct(tx, seller, product.id)),
    ).rejects.toThrow(
      'Only a draft or rejected product can be deleted; a product that was on sale is archived instead',
    )
  })
})
