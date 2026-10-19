import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  catalogueImports,
  categories,
  productVariants,
  products,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '../../lib/storage.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestBrand,
  createTestCategory,
  createTestSeller,
} from '../../testing/fixtures.ts'
import { createTestWorkbook } from '../../testing/spreadsheets.ts'
import { createProduct, type SellerContext } from '../catalogue/products.ts'
import { readImportFile, runImport } from './jobs.ts'
import {
  createImport,
  createImportUpload,
  getImport,
  getImportErrorReport,
  listImports,
  RUN_IMPORT_QUEUE,
  setImportMapping,
} from './service.ts'
import type { ImportField, ImportUpload, ImportView } from './types.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'imports-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const jobs = { db: worker, storage }
let queue: JobQueue
let seller: SellerContext
let other: SellerContext
let category: { id: string; name: string }
let parent: { id: string; name: string }
let brand: { id: string; name: string }

async function newSeller(): Promise<SellerContext> {
  const { owner: user, seller: business } = await createTestSeller(owner)
  return { role: 'seller', userId: user.id, sellerId: business.id }
}

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'imports-test')
  seller = await newSeller()
  other = await newSeller()
  category = await createTestCategory(owner)
  parent = await createTestCategory(owner)
  // A subcategory, so the parent is not the most specific category.
  const child = crypto.randomUUID().slice(0, 8)
  await owner.insert(categories).values({
    parentId: parent.id,
    depth: 1,
    name: `Subcategory ${child}`,
    slug: `subcategory-${child}`,
    gstRateBps: 1800,
  })
  brand = await createTestBrand(owner)
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

const as = <T>(
  context: RequestContext,
  work: (tx: Parameters<Parameters<typeof withContext>[2]>[0]) => Promise<T>,
) => withContext(web, context, work)

/** Posts the file with the signed form, the way a browser does. */
async function post(form: ImportUpload, bytes: Buffer): Promise<void> {
  const body = new FormData()
  for (const [name, value] of Object.entries(form.fields))
    body.append(name, value)
  body.append('file', new Blob([bytes]))
  const response = await fetch(form.url, { method: 'POST', body })
  expect(response.status).toBe(204)
}

/** Uploads a file and adds it as an import, as the seller's browser does. */
async function upload(
  bytes: Buffer | null,
  fileName = 'products.csv',
  who: SellerContext = seller,
): Promise<{ view: ImportView; key: string }> {
  const form = await createImportUpload(storage, who, {
    fileName,
    size: bytes?.length ?? 100,
  })
  if (bytes) await post(form, bytes)
  const view = await as(who, (tx) =>
    createImport(tx, queue, who, { uploadKey: form.key, fileName }),
  )
  return { view, key: form.key }
}

const view = (id: string, who: SellerContext = seller) =>
  as(who, (tx) => getImport(tx, who, id))

/** Uploads a file and has the worker read it. */
async function readFile(bytes: Buffer, fileName = 'products.csv') {
  const { view: created, key } = await upload(bytes, fileName)
  await readImportFile(jobs, created.id, key)
  return view(created.id)
}

const mapColumns = (id: string, columnMapping: Record<string, string>) =>
  as(seller, (tx) => setImportMapping(tx, queue, seller, id, { columnMapping }))

const csv = (rows: string[][]) =>
  Buffer.from(
    rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','),
      )
      .join('\r\n'),
  )

const HEADINGS = [
  'Product Name',
  'Category',
  'Item Code',
  'Price (Rs)',
  'MRP',
  'Qty',
]
const MAPPING: Record<string, ImportField> = {
  'Product Name': 'title',
  Category: 'category',
  'Item Code': 'sku',
  'Price (Rs)': 'price',
  MRP: 'mrp',
  Qty: 'stock',
}
const uniqueSku = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`

describe('uploading a file', () => {
  test('signs a form for a CSV or Excel file under the seller, valid for 30 minutes', async () => {
    const forCsv = await createImportUpload(storage, seller, {
      fileName: 'products.csv',
      size: 2000,
    })
    expect(forCsv.key).toMatch(
      new RegExp(`^uploads/${seller.sellerId}/import-[0-9a-f-]{36}$`),
    )
    expect(forCsv.maxBytes).toBe(10 * 1024 * 1024)
    expect(forCsv.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      29 * 60 * 1000,
    )
    expect(forCsv.fields['Content-Type']).toBe('text/csv')
    const forExcel = await createImportUpload(storage, seller, {
      fileName: 'Products.XLSX',
      size: 2000,
    })
    expect(forExcel.fields['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })

  test('refuses other files, files over 10 MB, and anyone but a seller', async () => {
    expect(
      await validationIssues(
        createImportUpload(storage, seller, {
          fileName: 'products.xls',
          size: 11 * 1024 * 1024,
        }),
      ),
    ).toEqual([
      'fileName must end with .csv or .xlsx',
      'size must be at most 10 MB',
    ])
    await expect(
      createImportUpload(
        storage,
        { role: 'admin', userId: seller.userId },
        {
          fileName: 'products.csv',
          size: 10,
        },
      ),
    ).rejects.toThrow(ForbiddenError)
  })

  test("refuses another seller's upload", async () => {
    const form = await createImportUpload(storage, other, {
      fileName: 'products.csv',
      size: 10,
    })
    expect(
      await validationIssues(
        as(seller, (tx) =>
          createImport(tx, queue, seller, {
            uploadKey: form.key,
            fileName: 'products.csv',
          }),
        ),
      ),
    ).toEqual(['uploadKey is not one of your uploads'])
  })
})

describe('reading the file', () => {
  test('stores the headings and rows, keeps the file privately, and removes the upload', async () => {
    const bytes = csv([
      HEADINGS,
      ...Array.from({ length: 7 }, (_, n) => [
        `Jute Bag ${n + 1}`,
        category.name,
        `JB-${n + 1}`,
        '349',
        '399',
        '10',
      ]),
    ])
    const { view: created, key } = await upload(bytes)
    expect(created).toMatchObject({
      status: 'uploaded',
      fileName: 'products.csv',
      fileType: 'csv',
      headers: null,
      sampleRows: [],
    })

    await readImportFile(jobs, created.id, key)
    const read = await view(created.id)
    expect(read).toMatchObject({
      status: 'uploaded',
      headers: HEADINGS,
      totalRows: 7,
      error: null,
      hasErrorReport: false,
    })
    expect(read.sampleRows).toHaveLength(5)
    expect(read.sampleRows[0]).toEqual([
      'Jute Bag 1',
      category.name,
      'JB-1',
      '349',
      '399',
      '10',
    ])
    const kept = `imports/${created.id}/source.csv`
    expect(await storage.read(kept)).toEqual(bytes)
    expect((await fetch(storage.publicUrl(kept))).status).toBe(403)
    expect(await storage.read(key)).toBeNull()

    // Running the job again changes nothing.
    await readImportFile(jobs, created.id, key)
    expect((await view(created.id)).totalRows).toBe(7)
  })

  test('fails an import it cannot read, with a reason the seller sees', async () => {
    const cases: [Buffer | null, string, string][] = [
      [
        null,
        'products.csv',
        'The upload did not arrive; upload the file again',
      ],
      [
        Buffer.from([0xff, 0xfe, 0x54, 0x00]),
        'products.csv',
        'The file is not UTF-8 text; in Excel, save it as "CSV UTF-8 (Comma delimited)" and upload it again',
      ],
      [
        Buffer.from('Title\nJute Bag\n'),
        'products.xlsx',
        'The file is not a readable Excel workbook (.xlsx)',
      ],
    ]
    for (const [bytes, fileName, reason] of cases) {
      const { view: created, key } = await upload(bytes, fileName)
      await readImportFile(jobs, created.id, key)
      expect(await view(created.id)).toMatchObject({
        status: 'failed',
        error: reason,
        headers: null,
      })
      expect((await view(created.id)).completedAt).not.toBeNull()
    }
  })
})

describe('choosing the columns', () => {
  test('waits for the file, refuses a wrong mapping, and accepts one mapping only', async () => {
    const { view: created, key } = await upload(
      csv([HEADINGS, ['Jute Bag', category.name, 'JB-1', '349', '399', '10']]),
    )
    await expect(mapColumns(created.id, MAPPING)).rejects.toThrow(
      new ConflictError(
        'The file is still being read; try again in a few seconds',
      ),
    )
    await readImportFile(jobs, created.id, key)

    expect(
      await validationIssues(
        mapColumns(created.id, {
          'Product Name': 'title',
          Category: 'title',
          Colour: 'description',
          Qty: 'weight',
        }),
      ),
    ).toEqual([
      'columnMapping.Qty must be one of title, category, sku, price, mrp, stock, description, highlights, brand, hsnCode, minOrderQuantity',
    ])
    expect(
      await validationIssues(
        mapColumns(created.id, {
          'Product Name': 'title',
          Category: 'title',
          Colour: 'description',
        }),
      ),
    ).toEqual([
      '"Colour" is not a column of the file',
      'title can come from only one column',
      'category needs a column',
      'sku needs a column',
      'price needs a column',
      'mrp needs a column',
      'stock needs a column',
    ])

    const mapped = await mapColumns(created.id, MAPPING)
    expect(mapped).toMatchObject({
      status: 'mapping_confirmed',
      columnMapping: MAPPING,
    })
    const queued = await owner.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${RUN_IMPORT_QUEUE} and data->>'importId' = ${created.id}`,
    )
    expect(queued.rows[0]).toEqual({ count: 1 })
    await expect(mapColumns(created.id, MAPPING)).rejects.toThrow(
      new ConflictError(
        'The columns can be chosen only once, before the import runs',
      ),
    )
  })
})

describe('running the import', () => {
  test('makes a draft for each good row and reports the rest in a safe CSV', async () => {
    const taken = uniqueSku('TAKEN')
    await as(seller, (tx) =>
      createProduct(tx, storage, seller, {
        categoryId: category.id,
        title: 'Existing Bamboo Comb',
        variants: [{ sku: taken, pricePaise: 9900, mrpPaise: 9900, stock: 1 }],
      }),
    )
    const good = uniqueSku('NTS')
    const twice = uniqueSku('TWICE')
    const book = createTestWorkbook([
      [...HEADINGS, 'Brand', 'Min qty', 'Points'],
      // Row 2: good, with numbers as Excel stores them.
      [
        'Neem Soap, 100 g',
        category.name,
        good,
        1299.5,
        1500,
        40,
        brand.name,
        5,
        'Neem | Tulsi',
      ],
      // Row 3: two problems.
      [null, category.name, uniqueSku('X'), 'free', 100, 1, null, null, null],
      // Rows 4 and 5: the same SKU twice.
      ['Bamboo Straw', category.name, twice, 50, 60, 500, null, null, null],
      [
        'Bamboo Straw, Pack',
        category.name,
        twice.toLowerCase(),
        50,
        60,
        500,
        null,
        null,
        null,
      ],
      // Row 6: an SKU the seller already uses.
      ['Bamboo Comb', category.name, taken, 99, 99, 1, null, null, null],
      // Row 7: a category with subcategories, refused by createProduct.
      ['Jute Mat', parent.name, uniqueSku('JM'), 499, 599, 3, null, null, null],
      // Row 8: a title that would run as a formula in a spreadsheet.
      [
        '=HYPERLINK("http://evil.test","Click")',
        category.name,
        uniqueSku('F'),
        10,
        5,
        1,
        null,
        null,
        null,
      ],
    ])
    const read = await readFile(book, 'catalogue.xlsx')
    expect(read).toMatchObject({ status: 'uploaded', totalRows: 7 })
    await mapColumns(read.id, {
      ...MAPPING,
      Brand: 'brand',
      'Min qty': 'minOrderQuantity',
      Points: 'highlights',
    })

    await runImport(jobs, read.id)

    const done = await view(read.id)
    expect(done).toMatchObject({
      status: 'completed',
      totalRows: 7,
      okRows: 2,
      errorRows: 5,
      hasErrorReport: true,
      error: null,
    })
    expect(done.completedAt).not.toBeNull()

    const drafts = await owner
      .select({
        title: products.title,
        status: products.status,
        sellerId: products.sellerId,
        brandId: products.brandId,
        minOrderQuantity: products.minOrderQuantity,
        highlights: products.highlights,
        sku: productVariants.sku,
        pricePaise: productVariants.pricePaise,
        mrpPaise: productVariants.mrpPaise,
        stock: productVariants.stock,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.sku, [good, twice]))
    expect(drafts.toSorted((a, b) => a.sku.localeCompare(b.sku))).toEqual(
      [
        {
          title: 'Neem Soap, 100 g',
          status: 'draft',
          sellerId: seller.sellerId,
          brandId: brand.id,
          minOrderQuantity: 5,
          highlights: ['Neem', 'Tulsi'],
          sku: good,
          pricePaise: 129_950,
          mrpPaise: 150_000,
          stock: 40,
        },
        {
          title: 'Bamboo Straw',
          status: 'draft',
          sellerId: seller.sellerId,
          brandId: null,
          minOrderQuantity: 1,
          highlights: [],
          sku: twice,
          pricePaise: 5000,
          mrpPaise: 6000,
          stock: 500,
        },
      ].toSorted((a, b) => a.sku.localeCompare(b.sku)),
    )

    const report = await getImportErrorReport(
      { db: web, storage },
      seller,
      read.id,
    )
    expect(report.fileName).toBe('catalogue - rows not imported.csv')
    const response = await fetch(report.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain(
      'catalogue - rows not imported.csv',
    )
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      await response.arrayBuffer(),
    )
    const lines = text.split('\r\n')
    expect(lines[0]).toBe(
      '\ufeff"Row","Problem","Product Name","Category","Item Code","Price (Rs)","MRP","Qty","Brand","Min qty","Points"',
    )
    // Each failed row: its number, the problem, then the row as uploaded.
    const expected = [
      '"3","""Product Name"" is empty; ""Price (Rs)"" must be an amount in rupees, such as 1299 or 1,299.50","",',
      `"5","""Item Code"" ""${twice.toLowerCase()}"" is already on row 4 of this file","Bamboo Straw, Pack",`,
      `"6","""Item Code"" ""${taken}"" is already used by another of your products","Bamboo Comb",`,
      '"7","""Category"" has subcategories; choose the most specific one","Jute Mat",',
      '"8","""MRP"" must be at least ""Price (Rs)""",',
    ]
    expect(
      lines
        .slice(1, -1)
        .map((line, index) => line.slice(0, expected[index]?.length)),
    ).toEqual(expected)
    // The formula arrives as text.
    expect(lines[5]).toContain('"\'=HYPERLINK(""http://evil.test"",""Click"")"')

    // Running the job again makes nothing more.
    await runImport(jobs, read.id)
    const again = await owner
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.sku, good))
    expect(again).toHaveLength(1)
  })

  test('picks up where it stopped, without a second draft for a row', async () => {
    const skus = [uniqueSku('A'), uniqueSku('B'), uniqueSku('C')]
    const read = await readFile(
      csv([
        HEADINGS,
        ...skus.map((sku) => [
          'Coir Door Mat',
          category.name,
          sku,
          '499',
          '599',
          '5',
        ]),
      ]),
    )
    await mapColumns(read.id, MAPPING)
    // Storage fails when the report would be written, after the drafts.
    const broken: ObjectStorage = {
      ...storage,
      write: () => Promise.reject(new Error('Storage is down')),
    }
    // A product with the third SKU appears meanwhile, so one row fails and a
    // report is needed.
    await as(seller, (tx) =>
      createProduct(tx, storage, seller, {
        categoryId: category.id,
        title: 'Coir Door Mat',
        variants: [
          { sku: skus[2]!, pricePaise: 49_900, mrpPaise: 59_900, stock: 1 },
        ],
      }),
    )
    await expect(
      runImport({ db: worker, storage: broken }, read.id, {
        lastAttempt: false,
      }),
    ).rejects.toThrow('Storage is down')
    expect((await view(read.id)).status).toBe('importing')

    await runImport(jobs, read.id)
    expect(await view(read.id)).toMatchObject({
      status: 'completed',
      okRows: 2,
      errorRows: 1,
    })
    const made = await owner
      .select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(products.sellerId, seller.sellerId),
          inArray(productVariants.sku, skus),
        ),
      )
    expect(made.map((row) => row.sku).toSorted()).toEqual(skus.toSorted())
  })

  test('gives up with a reason on the last attempt', async () => {
    const read = await readFile(
      csv([
        HEADINGS,
        ['Coir Door Mat', category.name, uniqueSku('D'), 'x', '599', '5'],
      ]),
    )
    await mapColumns(read.id, MAPPING)
    const broken: ObjectStorage = {
      ...storage,
      write: () => Promise.reject(new Error('Storage is down')),
    }
    await runImport({ db: worker, storage: broken }, read.id)
    expect(await view(read.id)).toMatchObject({
      status: 'failed',
      error:
        'The import stopped because of a problem on our side; the drafts made so far are kept',
    })
  })

  test('has no error report when every row was imported', async () => {
    const read = await readFile(
      csv([
        HEADINGS,
        ['Coir Door Mat', category.name, uniqueSku('E'), '499', '599', '5'],
      ]),
    )
    await expect(
      getImportErrorReport({ db: web, storage }, seller, read.id),
    ).rejects.toThrow(
      new ConflictError(
        'The error report is ready once the import has finished',
      ),
    )
    await mapColumns(read.id, MAPPING)
    await runImport(jobs, read.id)
    expect(await view(read.id)).toMatchObject({
      status: 'completed',
      okRows: 1,
      errorRows: 0,
      hasErrorReport: false,
    })
    await expect(
      getImportErrorReport({ db: web, storage }, seller, read.id),
    ).rejects.toThrow(
      new ConflictError('Every row was imported, so there is no error report'),
    )
  })
})

describe('who sees an import', () => {
  test('a seller sees only their own imports, newest first, a page at a time', async () => {
    const someone = await newSeller()
    const first = await upload(null, 'first.csv', someone)
    const second = await upload(null, 'second.csv', someone)
    const page = await as(someone, (tx) =>
      listImports(tx, someone, { limit: 1 }),
    )
    expect(page.items.map((item) => item.fileName)).toEqual(['second.csv'])
    const next = await as(someone, (tx) =>
      listImports(tx, someone, { limit: 1, cursor: page.nextCursor! }),
    )
    expect(next.items.map((item) => item.fileName)).toEqual(['first.csv'])
    expect(next.nextCursor).toBeNull()

    await expect(view(first.view.id, other)).rejects.toThrow(NotFoundError)
    await expect(
      getImportErrorReport({ db: web, storage }, other, second.view.id),
    ).rejects.toThrow(NotFoundError)
    // Row-level security hides it as well.
    const seen = await as(other, (tx) =>
      tx
        .select({ id: catalogueImports.id })
        .from(catalogueImports)
        .where(eq(catalogueImports.id, first.view.id)),
    )
    expect(seen).toEqual([])
  })
})
