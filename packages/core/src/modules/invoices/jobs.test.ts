import { eq } from 'drizzle-orm'
import { extractText, getDocumentProxy } from 'unpdf'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { invoices } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '../../lib/storage.ts'
import {
  createTestCategory,
  createTestInvoicingSeller,
  createTestOrderWithLines,
  createTestProduct,
  createTestUser,
  orderToInvoiceFor,
  type TestOrderLine,
} from '../../testing/fixtures.ts'
import { renderInvoice } from './jobs.ts'
import { cancelInvoices, issueInvoices } from './service.ts'

/*
 * The PDF job (backend spec step 14) against real object storage, reading
 * the text back out of the PDF the way a PDF viewer does.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'invoice-jobs-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const deps = { db: worker, storage }
let queue: JobQueue
let categoryId: string

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'invoice-jobs-test')
  categoryId = (await createTestCategory(owner)).id
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

async function issuedInvoice(
  lines: Omit<TestOrderLine, 'sellerId' | 'productId' | 'variantId'>[],
  options: { sellerState?: string; deliveryState?: string } = {},
) {
  const { seller } = await createTestInvoicingSeller(owner, {
    stateCode: options.sellerState ?? '27',
  })
  const { product, variant } = await createTestProduct(owner, {
    sellerId: seller.id,
    categoryId,
  })
  const buyer = await createTestUser(owner, 'buyer')
  const { order, items } = await createTestOrderWithLines(owner, {
    buyerId: buyer.id,
    shippingStateCode: options.deliveryState ?? '27',
    lines: lines.map((line) => ({
      ...line,
      sellerId: seller.id,
      productId: product.id,
      variantId: variant.id,
    })),
  })
  const [invoice] = await withContext(web, { role: 'system' }, (tx) =>
    issueInvoices(tx, queue, orderToInvoiceFor(order, items)),
  )
  return { invoice: invoice!, seller, order }
}

async function storedKey(invoiceId: string): Promise<string | null> {
  const [row] = await owner
    .select({ key: invoices.pdfStorageKey })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
  return row!.key
}

/** The PDF's text, with runs of spaces and line breaks made single spaces. */
async function pdfText(key: string): Promise<{ text: string; pages: number }> {
  const bytes = await storage.read(key)
  const pdf = await getDocumentProxy(new Uint8Array(bytes!))
  const { text, totalPages } = await extractText(pdf, { mergePages: true })
  return { text: text.replace(/\s+/g, ' '), pages: totalPages }
}

describe('the invoice PDF job', () => {
  test('makes the PDF, stores it privately, and records where', async () => {
    const { invoice, seller, order } = await issuedInvoice([
      {
        title: 'Steel Bottle, 750 ml',
        options: { Colour: 'Silver' },
        hsnCode: '7323',
        quantity: 2,
        discountSharePaise: 10_000,
      },
    ])
    await renderInvoice(deps, invoice.id)

    const key = await storedKey(invoice.id)
    expect(key).toBe(`invoices/${seller.id}/${invoice.id}.pdf`)
    const { text, pages } = await pdfText(key!)
    expect(pages).toBe(1)
    for (const printed of [
      'Tax Invoice',
      `Invoice number ${invoice.invoiceNumber}`,
      `Order number ${order.orderNumber}`,
      'Payment Paid online',
      seller.legalName,
      'GSTIN 27AAACE1234F1Z5',
      '+91 98000 00000',
      'Maharashtra (27)',
      'Asha Patil',
      'Place of supply Maharashtra (27)',
      'Within the state (CGST and SGST)',
      'Tax payable on reverse charge No',
      'Steel Bottle, 750 ml',
      'Colour: Silver',
      '7323',
      // ₹1,000 less ₹100 discount; 18% back-calculated and split in two.
      '₹500.00 ₹100.00 ₹762.71 9% ₹68.64 9% ₹68.65 ₹900.00',
      'Unit prices include GST. The taxable value is after the discount.',
      'Total ₹900.00',
      'Rupees Nine Hundred Only',
      `For ${seller.legalName}`,
      'Authorised signatory',
      'Page 1 of 1',
    ]) {
      expect(text).toContain(printed)
    }
    // The bucket keeps it private: only a signed link opens it.
    expect((await fetch(storage.publicUrl(key!))).status).toBe(403)
  })

  test('prints IGST between states and leaves out an empty discount column', async () => {
    const { invoice } = await issuedInvoice([{}], {
      sellerState: '29',
      deliveryState: '27',
    })
    await renderInvoice(deps, invoice.id)
    const { text } = await pdfText((await storedKey(invoice.id))!)
    expect(text).toContain('Karnataka (29)')
    expect(text).toContain('Between states (IGST)')
    expect(text).toContain('Taxable value IGST Total')
    expect(text).toContain('₹423.73 18% ₹76.27 ₹500.00')
    expect(text).not.toContain('CGST')
    expect(text).not.toContain('Discount')
    expect(text).not.toContain('after the discount')
  })

  test('titles 0% goods a bill of supply', async () => {
    const onlyUntaxed = await issuedInvoice([{ gstRateBps: 0 }])
    const mixed = await issuedInvoice([{ gstRateBps: 0 }, { gstRateBps: 500 }])
    await renderInvoice(deps, onlyUntaxed.invoice.id)
    await renderInvoice(deps, mixed.invoice.id)
    expect(
      (await pdfText((await storedKey(onlyUntaxed.invoice.id))!)).text,
    ).toMatch(/^Bill of Supply /)
    expect((await pdfText((await storedKey(mixed.invoice.id))!)).text).toMatch(
      /^Invoice-cum-Bill of Supply /,
    )
  })

  test('breaks a long invoice across pages', async () => {
    const { invoice } = await issuedInvoice(
      Array.from({ length: 40 }, (_, index) => ({
        title: `Item ${index + 1}`,
      })),
    )
    await renderInvoice(deps, invoice.id)
    const { text, pages } = await pdfText((await storedKey(invoice.id))!)
    expect(pages).toBeGreaterThan(1)
    expect(text).toContain(`Page ${pages} of ${pages}`)
    expect(text).toContain('Item 40')
    expect(text).toContain('Total ₹20,000.00')
  })

  test('marks a cancelled invoice as cancelled', async () => {
    const { invoice, order } = await issuedInvoice([{}])
    await withContext(web, { role: 'system' }, (tx) =>
      cancelInvoices(tx, queue, {
        orderId: order.id,
        reason: 'Cancelled by the buyer before dispatch',
      }),
    )
    await renderInvoice(deps, invoice.id)
    const key = (await storedKey(invoice.id))!
    expect(key).toMatch(/-cancelled\.pdf$/)
    const { text } = await pdfText(key)
    expect(text).toContain('This invoice is cancelled.')
    expect(text).toContain('Reason: Cancelled by the buyer before dispatch')
    expect(text).toContain(`Tax Invoice ${invoice.invoiceNumber} (cancelled)`)
    expect(text).toContain('CANCELLED')
  })

  test('replaces the file when run again, and ignores an unknown invoice', async () => {
    const { invoice } = await issuedInvoice([{}])
    await renderInvoice(deps, invoice.id)
    const key = (await storedKey(invoice.id))!
    await storage.write(key, Buffer.from('old'), {
      contentType: 'application/pdf',
    })
    await renderInvoice(deps, invoice.id)
    expect((await storage.read(key))!.subarray(0, 5)).toEqual(
      Buffer.from('%PDF-'),
    )
    await renderInvoice(deps, crypto.randomUUID())
  })

  test('throws when storage fails, so the job is retried', async () => {
    const { invoice } = await issuedInvoice([{}])
    const failing: ObjectStorage = {
      ...storage,
      write: () => Promise.reject(new Error('Storage is unavailable')),
    }
    await expect(
      renderInvoice({ db: worker, storage: failing }, invoice.id, {
        lastAttempt: false,
      }),
    ).rejects.toThrow('Storage is unavailable')
    expect(await storedKey(invoice.id)).toBeNull()
  })
})
