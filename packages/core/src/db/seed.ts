import { randomBytes, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { requireEnv } from '../env.ts'
import type { JobQueue } from '../lib/queue.ts'
import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '../lib/storage.ts'
import {
  createAccountDirectory,
  type AccountDirectory,
} from '../modules/auth/accounts.ts'
import { createAppAuth } from '../modules/auth/service.ts'
import { createBrand, listAllBrands } from '../modules/catalogue/brands.ts'
import {
  createCategory,
  loadCategoryTree,
} from '../modules/catalogue/categories.ts'
import {
  addImage,
  PROCESS_IMAGE_QUEUE,
  processImageJob,
} from '../modules/catalogue/images.ts'
import { processUploadedImage } from '../modules/catalogue/jobs.ts'
import {
  approveProduct,
  submitProduct,
} from '../modules/catalogue/moderation.ts'
import {
  createProduct,
  listOwnProducts,
  type SellerContext,
} from '../modules/catalogue/products.ts'
import {
  SCREEN_LISTING_QUEUE,
  screenListing,
  screenListingJob,
} from '../modules/catalogue/screening.ts'
import type { NewVariant } from '../modules/catalogue/types.ts'
import {
  approveSeller,
  createSeller,
  findSellerForOwner,
} from '../modules/sellers/service.ts'
import type { NewSeller } from '../modules/sellers/types.ts'
import {
  settingKeys,
  type SettingKey,
  type SettingValue,
} from '../modules/settings/definitions.ts'
import { listSettings, updateSetting } from '../modules/settings/service.ts'
import { createDatabase, type Database } from './client.ts'
import { withContext } from './context.ts'
import { createPool } from './pool.ts'

/**
 * Example values for the settings only the client can decide, so a local
 * copy can run checkout. Every value is obviously an example; staging and
 * production get the client's real values from an administrator.
 */
export const DEVELOPMENT_SETTINGS: { [K in SettingKey]?: SettingValue<K> } = {
  commission_bps: 1000,
  delivery_charge_paise: 4900,
  free_delivery_threshold_paise: 49_900,
  company_details: {
    legalName: 'EcoKart Example Private Limited',
    displayName: 'EcoKart (example data)',
    gstin: '27AAACE1234F1Z5',
    pan: 'AAACE1234F',
    address: {
      line1: '1 Example Road',
      line2: null,
      city: 'Pune',
      stateCode: '27',
      pincode: '411001',
    },
    supportEmail: 'support@ecokart.test',
    supportPhone: '+912012345678',
    grievanceOfficer: {
      name: 'Example Grievance Officer',
      email: 'grievance@ecokart.test',
      phone: '+912012345679',
    },
  },
}

/** A category of the example tree, with the categories inside it. */
export interface ExampleCategory {
  name: string
  gstRateBps: number
  defaultHsnCode?: string
  children?: ExampleCategory[]
}

/**
 * A small example tree, three levels deep. The rates and HSN codes are
 * plausible examples only, not tax advice; the real ones come from the
 * client's chartered accountant.
 */
export const DEVELOPMENT_CATEGORIES: ExampleCategory[] = [
  {
    name: 'Home & Kitchen',
    gstRateBps: 1800,
    children: [
      {
        name: 'Kitchen & Dining',
        gstRateBps: 1800,
        children: [
          {
            name: 'Bamboo Kitchenware',
            gstRateBps: 500,
            defaultHsnCode: '4419',
          },
          { name: 'Steel Bottles', gstRateBps: 500, defaultHsnCode: '7323' },
        ],
      },
      {
        name: 'Storage & Organisation',
        gstRateBps: 1800,
        children: [
          { name: 'Jute Bags', gstRateBps: 500, defaultHsnCode: '6305' },
        ],
      },
    ],
  },
  {
    name: 'Personal Care',
    gstRateBps: 1800,
    children: [
      {
        name: 'Oral Care',
        gstRateBps: 500,
        children: [
          {
            name: 'Bamboo Toothbrushes',
            gstRateBps: 500,
            defaultHsnCode: '9603',
          },
        ],
      },
      {
        name: 'Bath & Body',
        gstRateBps: 500,
        children: [
          { name: 'Handmade Soaps', gstRateBps: 500, defaultHsnCode: '3401' },
        ],
      },
    ],
  },
]

export const DEVELOPMENT_BRANDS = [
  'Bamboo Home',
  'Khadi Threads',
  'Terra Earthware',
]

/** Three approved example sellers; owners sign in with these emails. */
export const DEVELOPMENT_SELLERS: NewSeller[] = [
  {
    owner: {
      email: 'seller1@ecokart.test',
      name: 'Ravi Kumar',
      phoneNumber: null,
    },
    displayName: 'Green Basket (example)',
    legalName: 'Green Basket Organics Private Limited',
    gstin: '27AABCG1234K1Z9',
    pan: 'AABCG1234K',
    line1: '12 MG Road',
    city: 'Pune',
    stateCode: '27',
    pincode: '411001',
    supportEmail: 'help@greenbasket.test',
    supportPhone: '+912012340001',
    invoicePrefix: 'GRB',
    commissionBps: null,
  },
  {
    owner: {
      email: 'seller2@ecokart.test',
      name: 'Lakshmi Rao',
      phoneNumber: null,
    },
    displayName: 'Bamboo Home (example)',
    legalName: 'Bamboo Home Crafts LLP',
    gstin: '29AACCB5678L1Z3',
    pan: 'AACCB5678L',
    line1: '5 Brigade Road',
    city: 'Bengaluru',
    stateCode: '29',
    pincode: '560001',
    supportEmail: 'care@bamboohome.test',
    supportPhone: '+918012340002',
    invoicePrefix: 'BMH',
    commissionBps: 800,
  },
  {
    owner: {
      email: 'seller3@ecokart.test',
      name: 'Imran Siddiqui',
      phoneNumber: null,
    },
    displayName: 'Khadi Threads (example)',
    legalName: 'Khadi Threads Private Limited',
    gstin: '07AADCK9012M1Z7',
    pan: 'AADCK9012M',
    line1: '3 Janpath',
    city: 'New Delhi',
    stateCode: '07',
    pincode: '110001',
    supportEmail: 'hello@khadithreads.test',
    supportPhone: '+911112340003',
    invoicePrefix: 'KHT',
    commissionBps: null,
  },
]

export interface SeedResult {
  settings: SettingKey[]
  /** Owner emails of the sellers created. */
  sellers: string[]
  /** Names of the categories created. */
  categories: string[]
  /** Names of the brands created. */
  brands: string[]
}

/**
 * Fills in example data for local development (`pnpm db:seed`). It only adds
 * what is missing, never overwrites a saved value, goes through the same
 * services as the app, and refuses to run in production.
 */
export async function seedDevelopmentData(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedResult> {
  if (env.NODE_ENV === 'production') {
    throw new Error('The development seed never runs in production')
  }
  return {
    settings: await seedSettings(db),
    sellers: await seedSellers(db),
    categories: await seedCategories(db),
    brands: await seedBrands(db),
  }
}

async function seedCategories(db: Database): Promise<string[]> {
  return withContext(db, { role: 'system' }, async (tx) => {
    const created: string[] = []
    const tree = await loadCategoryTree(tx)
    const add = async (
      examples: ExampleCategory[],
      parentId: string | null,
    ): Promise<void> => {
      for (const { children = [], ...example } of examples) {
        const existing = tree
          .childrenOf(parentId)
          .find((category) => category.name === example.name)
        if (existing) {
          await add(children, existing.id)
          continue
        }
        const category = await createCategory(
          tx,
          { role: 'system' },
          { ...example, parentId },
        )
        created.push(example.name)
        await add(children, category.id)
      }
    }
    await add(DEVELOPMENT_CATEGORIES, null)
    return created
  })
}

async function seedBrands(db: Database): Promise<string[]> {
  return withContext(db, { role: 'system' }, async (tx) => {
    const created: string[] = []
    for (const name of DEVELOPMENT_BRANDS) {
      const { items } = await listAllBrands(tx, { role: 'system' }, { q: name })
      if (items.some((brand) => brand.name === name)) continue
      await createBrand(tx, { role: 'system' }, { name })
      created.push(name)
    }
    return created
  })
}

async function seedSellers(db: Database): Promise<string[]> {
  // The seed only creates accounts; it never signs anyone in or sends a code,
  // so this Better Auth needs no real secret.
  const accounts = createAccountDirectory(
    createAppAuth({
      db,
      getQueue: async () => {
        throw new Error('The seed sends no messages')
      },
      config: {
        baseURL: 'http://localhost:3000',
        secret: 'development-only-seed-secret-never-signs-sessions',
        encryptionKey: randomBytes(32),
        smsOtpEnabled: false,
      },
    }),
  )
  const created: string[] = []
  for (const seller of DEVELOPMENT_SELLERS) {
    if (await accounts.findByEmail(seller.owner.email)) continue
    const { id } = await createSeller(
      { db, accounts },
      { role: 'system' },
      seller,
    )
    await approveSeller(db, { role: 'system' }, id)
    created.push(seller.owner.email)
  }
  return created
}

async function seedSettings(db: Database): Promise<SettingKey[]> {
  return withContext(db, { role: 'system' }, async (tx) => {
    const current = await listSettings(tx, { role: 'system' })
    const saved = new Set(
      current.filter((s) => s.source === 'saved').map((s) => s.key),
    )
    const filled: SettingKey[] = []
    for (const key of settingKeys) {
      const value = DEVELOPMENT_SETTINGS[key]
      if (value === undefined || saved.has(key)) continue
      await updateSetting(tx, { role: 'system' }, key, value)
      filled.push(key)
    }
    return filled
  })
}

/** An example listing, which its seller creates and submits (backend spec step 7). */
export interface ExampleProduct {
  sellerEmail: string
  /** The name of a category at the bottom of the example tree. */
  category: string
  brand?: string
  title: string
  description: string
  highlights: string[]
  attributes: Record<string, string>
  optionNames?: string[]
  /** Left out: 1. */
  minOrderQuantity?: number
  variants: NewVariant[]
  /** The example photo: a circle of the second colour on the first. */
  colours: [string, string]
}

/** Two or three listings for each example seller; prices are examples only. */
export const DEVELOPMENT_PRODUCTS: ExampleProduct[] = [
  {
    sellerEmail: 'seller1@ecokart.test',
    category: 'Bamboo Toothbrushes',
    title: 'Bamboo Toothbrush, Pack of 4',
    description:
      'Four toothbrushes with handles of untreated bamboo, which can be composted after use.',
    highlights: ['Charcoal-infused bristles', 'Plastic-free paper box'],
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
        pricePaise: 19_900,
        mrpPaise: 24_900,
        stock: 80,
      },
    ],
    colours: ['#e8f0e3', '#7a9a5b'],
  },
  {
    sellerEmail: 'seller1@ecokart.test',
    category: 'Handmade Soaps',
    title: 'Handmade Neem and Tulsi Soap, 100 g',
    description:
      'Cold-process soap made in small batches with neem oil and tulsi leaves.',
    highlights: ['No palm oil', 'Wrapped in recycled paper'],
    attributes: { weight: '100 g' },
    variants: [
      { sku: 'SOAP-NEEM', pricePaise: 14_900, mrpPaise: 18_000, stock: 60 },
    ],
    colours: ['#f3efe2', '#4f7d4a'],
  },
  {
    sellerEmail: 'seller2@ecokart.test',
    category: 'Bamboo Kitchenware',
    brand: 'Bamboo Home',
    title: 'Bamboo Cutting Board',
    description:
      'A sturdy board cut from one piece of bamboo, finished with food-safe oil.',
    highlights: ['Gentle on knife edges', 'Juice groove on one side'],
    attributes: { material: 'bamboo', finish: 'food-safe oil' },
    optionNames: ['Size'],
    variants: [
      {
        sku: 'BCB-S',
        options: { Size: 'Small' },
        pricePaise: 44_900,
        mrpPaise: 59_900,
        stock: 30,
      },
      {
        sku: 'BCB-L',
        options: { Size: 'Large' },
        pricePaise: 69_900,
        mrpPaise: 89_900,
        stock: 20,
      },
    ],
    colours: ['#f5ead6', '#c49a5a'],
  },
  {
    sellerEmail: 'seller2@ecokart.test',
    category: 'Bamboo Kitchenware',
    brand: 'Bamboo Home',
    title: 'Bamboo Cooking Spatula Set of 3',
    description:
      'A turner, a slotted spatula, and a spoon for everyday cooking.',
    highlights: ['Heat resistant', 'Safe on non-stick pans'],
    attributes: { material: 'bamboo' },
    variants: [
      { sku: 'BSP-SET3', pricePaise: 29_900, mrpPaise: 39_900, stock: 50 },
    ],
    colours: ['#f1e4cc', '#a8773f'],
  },
  {
    sellerEmail: 'seller2@ecokart.test',
    category: 'Bamboo Kitchenware',
    brand: 'Bamboo Home',
    title: 'Bamboo Drinking Straw',
    description:
      'A reusable straw cut from a single bamboo stem, sold singly with a minimum of five.',
    highlights: ['Washable and reusable', 'Cleaning brush sold separately'],
    attributes: { material: 'bamboo', length: '20 cm' },
    minOrderQuantity: 5,
    variants: [
      { sku: 'BDS-1', pricePaise: 5_000, mrpPaise: 6_000, stock: 500 },
    ],
    colours: ['#f4edd8', '#b7924f'],
  },
  {
    sellerEmail: 'seller3@ecokart.test',
    category: 'Jute Bags',
    brand: 'Khadi Threads',
    title: 'Jute Shopping Bag with Handles',
    description:
      'A roomy shopping bag of natural jute with cotton handles, strong enough for a week of groceries.',
    highlights: ['Holds up to 10 kg', 'Folds flat'],
    attributes: { material: 'jute', handles: 'cotton' },
    optionNames: ['Colour'],
    variants: [
      {
        sku: 'JB-NAT',
        options: { Colour: 'Natural' },
        pricePaise: 34_900,
        mrpPaise: 39_900,
        stock: 40,
      },
      {
        sku: 'JB-GRN',
        options: { Colour: 'Green' },
        pricePaise: 34_900,
        mrpPaise: 39_900,
        stock: 25,
      },
    ],
    colours: ['#ede3cf', '#8c6b3e'],
  },
  {
    sellerEmail: 'seller3@ecokart.test',
    category: 'Steel Bottles',
    title: 'Insulated Steel Water Bottle, 1 L',
    description:
      'A double-walled stainless steel bottle that keeps water cold for 24 hours.',
    highlights: ['Leak-proof lid', 'No plastic inside'],
    attributes: { material: 'stainless steel', capacity: '1 L' },
    optionNames: ['Colour'],
    variants: [
      {
        sku: 'SWB-SLV',
        options: { Colour: 'Silver' },
        pricePaise: 89_900,
        mrpPaise: 1_19_900,
        stock: 35,
      },
      {
        sku: 'SWB-BLK',
        options: { Colour: 'Black' },
        pricePaise: 94_900,
        mrpPaise: 1_19_900,
        stock: 15,
      },
    ],
    colours: ['#e6ebef', '#5b6b78'],
  },
]

export interface ProductSeedServices {
  /** Connected as ecokart_web, like every other part of the seed. */
  db: Database
  /** Connected as ecokart_worker, to run the photo and screening jobs. */
  worker: Database
  storage: ObjectStorage
}

/**
 * Adds the example listings that are missing, approved, with a generated
 * photo each (`pnpm db:seed`, backend spec step 7). Each goes through the
 * same steps as a real one: the seller creates it, uploads a photo, and
 * submits it, the photo and screening jobs run, and the system approves it.
 * The seed runs those jobs itself, so the worker need not be running.
 * Needs the example sellers, categories, and brands (seedDevelopmentData).
 */
export async function seedExampleProducts(
  services: ProductSeedServices,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  if (env.NODE_ENV === 'production') {
    throw new Error('The development seed never runs in production')
  }
  // Finds the example sellers' accounts only; it never signs anyone in or
  // sends a code, so this Better Auth needs no real secret (as in
  // seedSellers).
  const accounts = createAccountDirectory(
    createAppAuth({
      db: services.db,
      getQueue: async () => {
        throw new Error('The seed sends no messages')
      },
      config: {
        baseURL: 'http://localhost:3000',
        secret: 'development-only-seed-secret-never-signs-sessions',
        encryptionKey: randomBytes(32),
        smsOtpEnabled: false,
      },
    }),
  )
  const created: string[] = []
  for (const example of DEVELOPMENT_PRODUCTS) {
    const seller = await exampleSeller(services.db, accounts, example)
    if (await hasListing(services, seller, example.title)) continue
    await seedProduct(services, seller, example)
    created.push(example.title)
  }
  return created
}

async function exampleSeller(
  db: Database,
  accounts: AccountDirectory,
  example: ExampleProduct,
): Promise<SellerContext> {
  const account = await accounts.findByEmail(example.sellerEmail)
  const seller =
    account &&
    (await withContext(db, { role: 'system' }, (tx) =>
      findSellerForOwner(tx, account.id),
    ))
  if (!account || !seller) {
    throw new Error(
      `The example seller ${example.sellerEmail} is missing; seed the sellers first`,
    )
  }
  return { role: 'seller', userId: account.id, sellerId: seller.id }
}

async function hasListing(
  { db, storage }: ProductSeedServices,
  seller: SellerContext,
  title: string,
): Promise<boolean> {
  let cursor: string | undefined
  do {
    const page = await withContext(db, seller, (tx) =>
      listOwnProducts(tx, storage, seller, cursor ? { cursor } : {}),
    )
    if (page.items.some((product) => product.title === title)) return true
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return false
}

/** The names from the top of the example tree down to the category `name`. */
function examplePath(
  name: string,
  examples: ExampleCategory[] = DEVELOPMENT_CATEGORIES,
): string[] | null {
  for (const example of examples) {
    if (example.name === name) return [name]
    const below = examplePath(name, example.children ?? [])
    if (below) return [example.name, ...below]
  }
  return null
}

/** A plain 1200 pixel square: a circle of one colour on another. */
const examplePhoto = ([background, circle]: [string, string]) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="${background}"/><circle cx="600" cy="600" r="380" fill="${circle}"/></svg>`,
    ),
  )
    .png()
    .toBuffer()

async function seedProduct(
  { db, worker, storage }: ProductSeedServices,
  seller: SellerContext,
  example: ExampleProduct,
): Promise<void> {
  // Jobs are collected and run once their transaction has committed, the
  // way the worker would pick them up.
  const jobs: { name: string; data: object }[] = []
  const queue: JobQueue = {
    send: async (_tx, name, data) => {
      jobs.push({ name, data })
    },
    stop: async () => {},
  }
  const runJobs = async () => {
    for (const { name, data } of jobs.splice(0)) {
      if (name === PROCESS_IMAGE_QUEUE) {
        const { imageId } = processImageJob.parse(data)
        await processUploadedImage({ db: worker, storage }, imageId)
      } else if (name === SCREEN_LISTING_QUEUE) {
        // The seed never calls an AI provider: the example listings get the
        // fixed checks and an "AI not checked" flag.
        await screenListing(
          { db: worker, storage, ai: null },
          screenListingJob.parse(data).reviewId,
        )
      } else {
        throw new Error(`The seed cannot run ${name} jobs`)
      }
    }
  }

  const { categoryId, brandId } = await withContext(
    db,
    { role: 'system' },
    async (tx) => {
      // Down the example tree by name, like seedCategories, so a category of
      // the same name elsewhere in the tree is never picked.
      const tree = await loadCategoryTree(tx)
      let category: { id: string } | undefined
      for (const name of examplePath(example.category) ?? []) {
        category = tree
          .childrenOf(category?.id ?? null)
          .find((candidate) => candidate.name === name)
        if (!category) break
      }
      const { items } = example.brand
        ? await listAllBrands(tx, { role: 'system' }, { q: example.brand })
        : { items: [] }
      const brand = items.find((candidate) => candidate.name === example.brand)
      if (!category || (example.brand && !brand)) {
        throw new Error(
          `The example category or brand of ${example.title} is missing; seed them first`,
        )
      }
      return { categoryId: category.id, brandId: brand?.id ?? null }
    },
  )
  const product = await withContext(db, seller, (tx) =>
    createProduct(tx, storage, seller, {
      categoryId,
      brandId,
      title: example.title,
      description: example.description,
      highlights: example.highlights,
      attributes: example.attributes,
      ...(example.optionNames ? { optionNames: example.optionNames } : {}),
      ...(example.minOrderQuantity
        ? { minOrderQuantity: example.minOrderQuantity }
        : {}),
      variants: example.variants,
    }),
  )
  const uploadKey = `uploads/${product.id}/${randomUUID()}`
  await storage.write(uploadKey, await examplePhoto(example.colours), {
    contentType: 'image/png',
  })
  await withContext(db, seller, (tx) =>
    addImage(tx, storage, queue, seller, product.id, {
      uploadKey,
      alt: example.title,
    }),
  )
  await runJobs()
  await withContext(db, seller, (tx) =>
    submitProduct(tx, storage, queue, seller, product.id),
  )
  await runJobs()
  await withContext(db, { role: 'system' }, (tx) =>
    approveProduct(tx, storage, { role: 'system' }, product.id, {}),
  )
}

/**
 * The worker's database address: the server of DATABASE_URL, as the
 * ecokart_worker user with the password `pnpm db:migrate` gave it.
 */
function workerDatabaseUrl(): string {
  const url = new URL(requireEnv('DATABASE_URL'))
  url.username = 'ecokart_worker'
  url.password = requireEnv('WORKER_DATABASE_PASSWORD')
  return url.toString()
}

if (import.meta.main) {
  const pool = createPool(requireEnv('DATABASE_URL'), 'ecokart-seed')
  const workerPool = createPool(workerDatabaseUrl(), 'ecokart-seed-worker')
  try {
    const { settings, sellers, categories, brands } = await seedDevelopmentData(
      createDatabase(pool),
    )
    const products = await seedExampleProducts({
      db: createDatabase(pool),
      worker: createDatabase(workerPool),
      storage: createObjectStorage(loadStorageConfig()),
    })
    console.info(
      settings.length === 0
        ? 'Settings: every example setting already has a saved value'
        : `Settings: saved example values for ${settings.join(', ')}`,
    )
    console.info(
      sellers.length === 0
        ? 'Sellers: the example sellers already exist'
        : `Sellers: created and approved ${sellers.join(', ')}; sign in with those emails`,
    )
    console.info(
      categories.length === 0
        ? 'Categories: the example tree already exists'
        : `Categories: created ${categories.join(', ')}`,
    )
    console.info(
      brands.length === 0
        ? 'Brands: the example brands already exist'
        : `Brands: created ${brands.join(', ')}`,
    )
    console.info(
      products.length === 0
        ? 'Products: the example products already exist'
        : `Products: created and approved ${products.join('; ')}`,
    )
  } catch (error) {
    console.error('Seeding failed', error)
    process.exitCode = 1
  } finally {
    await pool.end()
    await workerPool.end()
  }
}
