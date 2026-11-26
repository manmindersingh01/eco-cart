import {
  approveSeller,
  createAccountDirectory,
  createAppAuth,
  createCategory,
  createDatabase,
  createPool,
  createSeller,
  createObjectStorage,
  loadStorageConfig,
  ensureAdministrator,
  loadAuthConfig,
  updateSetting,
  withContext,
  startJobQueue,
  confirmOrderPayment,
  dispatchLines,
  markShipmentDelivered,
  openReturn,
  approveReturn,
  getOwnLedger,
  setSellerBankAccount,
  loadLedgerConfig,
  issueInvoices,
  type RequestContext,
  type JobQueue,
} from '@ecokart/core'
import {
  DEVELOPMENT_SETTINGS,
  seedDevelopmentData,
  seedExampleProducts,
} from '../../../../packages/core/src/db/seed.ts'
import {
  createTestOrder,
  createTestReturnRequest,
  createTestOrderWithLines,
  createTestProduct,
  createTestUser,
  addTestLedgerEntries,
  orderToInvoiceFor,
} from '@ecokart/core/testing'
import {
  createPayment,
  attachRazorpayOrder,
} from '../../../../packages/core/src/modules/payments/service.ts'
import { onOrderConfirmed } from '../../../../packages/core/src/modules/orders/service.ts'
import { SEND_EMAIL_QUEUE } from '../../../../packages/core/src/modules/notifications/jobs.ts'
import { settlementStatements } from '../../../../packages/core/src/db/schema/index.ts'

export const browserProjects = [
  'chromium-desktop',
  'chromium-phone',
  'firefox-desktop',
  'firefox-phone',
  'webkit-desktop',
  'webkit-phone',
]

export interface BrowserFixtures {
  categoryId: string
  adminMoney: Record<
    string,
    { sellerId: string; sellerEmail: string; ledgerSellerId: string }
  >
  orderProducts: Record<
    string,
    {
      sellerEmail: string
      otherSellerEmail: string
      firstVariantId: string
      secondVariantId: string
      firstTitle: string
      secondTitle: string
      refundOrderId: string
      returnsBuyerEmail: string
      gatewayReturnId: string
      bankReturnId: string
    }
  >
  accounts: Record<
    string,
    { sellerEmail: string; adminEmail: string; otherSellerEmail: string }
  >
}

export async function prepareFixtures(
  env: NodeJS.ProcessEnv,
  migrationUrl: string,
): Promise<BrowserFixtures> {
  const fixturePool = createPool(migrationUrl, 'e2e-order-fixtures')
  const fixtureDb = createDatabase(fixturePool)
  const queue = await startJobQueue(env.DATABASE_URL!, 'e2e-order-fixtures')
  // Fixture commerce emails would delay the real OTP jobs behind them.
  const refundFixtureQueue: JobQueue = {
    ...queue,
    async send(tx, name, data) {
      if (name !== SEND_EMAIL_QUEUE) await queue.send(tx, name, data)
    },
  }
  const unrenderedInvoiceQueue: JobQueue = {
    ...queue,
    send: () => Promise.resolve(),
  }
  const pool = createPool(env.DATABASE_URL!, 'e2e-fixtures')
  const db = createDatabase(pool)
  const storage = createObjectStorage(loadStorageConfig(env))
  const auth = createAppAuth({
    db,
    config: loadAuthConfig(env),
    getQueue: () => {
      throw new Error('Fixture setup must not send messages')
    },
  })
  const directory = createAccountDirectory(auth)
  const accounts: BrowserFixtures['accounts'] = {}
  const adminMoney: BrowserFixtures['adminMoney'] = {}
  const orderProducts: BrowserFixtures['orderProducts'] = {}
  let categoryId = ''
  try {
    const projects = [
      ...browserProjects,
      'chrome-desktop',
      'chrome-phone',
      'chrome-medium',
    ]
    for (const [index, project] of projects.entries()) {
      const adminEmail = `admin-${env.E2E_RUN_ID}-${index}@ecokart.test`
      const sellerEmail = `seller-${env.E2E_RUN_ID}-${index}@ecokart.test`
      await ensureAdministrator(auth, db, {
        email: adminEmail,
        name: `Test administrator ${index}`,
      })
      const admin = await directory.findByEmail(adminEmail)
      if (!admin) throw new Error('Administrator fixture was not created')
      const context: RequestContext = { role: 'admin', userId: admin.id }
      if (!categoryId) {
        categoryId = await withContext(db, context, async (tx) => {
          for (const [key, value] of Object.entries(DEVELOPMENT_SETTINGS)) {
            await updateSetting(tx, context, key, value)
          }
          const category = await createCategory(tx, context, {
            name: 'Browser test kitchenware',
            gstRateBps: 1800,
            defaultHsnCode: '4419',
          })
          return category.id
        })
      }
      const sellerInput = {
        owner: { email: sellerEmail, name: `Test seller ${index}` },
        displayName: `Browser test seller ${index}`,
        legalName: `Test seller ${index} Limited`,
        gstin: '27AAACE1234F1Z5',
        pan: 'AAACE1234F',
        line1: '1 Test Road',
        city: 'Pune',
        stateCode: '27',
        pincode: '411001',
        supportEmail: sellerEmail,
        supportPhone: '+919800000000',
        invoicePrefix: `E${index}T`,
      }
      const seller = await createSeller(
        { db, accounts: directory },
        context,
        sellerInput,
      )
      await approveSeller(db, context, seller.id)
      const otherSellerEmail = `other-seller-${env.E2E_RUN_ID}-${index}@ecokart.test`
      const otherSeller = await createSeller(
        { db, accounts: directory },
        context,
        {
          ...sellerInput,
          owner: {
            email: otherSellerEmail,
            name: `Other test seller ${index}`,
          },
          displayName: `Other browser seller ${index}`,
          legalName: `Other test seller ${index} Limited`,
          supportEmail: otherSellerEmail,
          invoicePrefix: `E${index}X`,
        },
      )
      await approveSeller(db, context, otherSeller.id)
      const orderSellerEmail = `orders-${sellerEmail}`
      const orderOtherEmail = `orders-${otherSellerEmail}`
      const orderSeller = await createSeller(
        { db, accounts: directory },
        context,
        {
          ...sellerInput,
          owner: { email: orderSellerEmail, name: 'Order seller' },
          invoicePrefix: `O${index}T`,
        },
      )
      const orderOther = await createSeller(
        { db, accounts: directory },
        context,
        {
          ...sellerInput,
          owner: { email: orderOtherEmail, name: 'Other order seller' },
          invoicePrefix: `O${index}X`,
        },
      )
      await approveSeller(db, context, orderSeller.id)
      await approveSeller(db, context, orderOther.id)
      const balanceEmail = `balance-${sellerEmail}`
      const balanceSeller = await createSeller(
        { db, accounts: directory },
        context,
        {
          ...sellerInput,
          owner: { email: balanceEmail, name: 'Balance fixture owner' },
          displayName: `Balance fixture ${index}`,
          invoicePrefix: `B${index}T`,
        },
      )
      await approveSeller(db, context, balanceSeller.id)
      await addTestLedgerEntries(fixtureDb, balanceSeller.id, [
        {
          entryType: 'adjustment',
          amountPaise: 100000000 + index,
          description: 'Balance list fixture',
        },
      ])
      adminMoney[project] = {
        sellerId: balanceSeller.id,
        sellerEmail: balanceEmail,
        ledgerSellerId: orderSeller.id,
      }
      await directory.addRole(orderSeller.ownerUserId, 'buyer')
      const earningsContext = {
        role: 'seller',
        userId: orderSeller.ownerUserId,
        sellerId: orderSeller.id,
      } as const
      const first = await createTestProduct(fixtureDb, {
        sellerId: orderSeller.id,
        categoryId,
      })
      const second = await createTestProduct(fixtureDb, {
        sellerId: orderOther.id,
        categoryId,
      })
      const buyer = await createTestUser(fixtureDb)
      // Enough real rows to exercise the seller page's 20-row cursor boundary.
      for (let count = 0; count < 21; count++) {
        const seededOrder = await createTestOrder(fixtureDb, {
          buyerId: buyer.id,
          lines: [
            {
              sellerId: orderSeller.id,
              productId: first.product.id,
              variantId: first.variant.id,
            },
          ],
        })
        // Keep one PDF unavailable without racing the real render worker.
        if (count === 0)
          await withContext(db, { role: 'system' }, (tx) =>
            issueInvoices(
              tx,
              unrenderedInvoiceQueue,
              orderToInvoiceFor(seededOrder.order, seededOrder.items),
            ),
          )
      }
      // Seed a captured online payment without contacting a payment provider.
      // Browser actions still use the real cancellation and refund endpoints.
      const refundable = await createTestOrderWithLines(fixtureDb, {
        buyerId: buyer.id,
        paymentMethod: 'razorpay',
        status: 'pending_payment',
        lines: [
          {
            sellerId: orderSeller.id,
            productId: first.product.id,
            variantId: first.variant.id,
            unitPricePaise: 12345,
          },
        ],
      })
      await withContext(db, { role: 'system' }, async (tx) => {
        const payment = await createPayment(tx, {
          orderId: refundable.order.id,
          provider: 'razorpay',
          amountPaise: 12345,
        })
        const providerId = `order_${env.E2E_RUN_ID}${index}`
        await attachRazorpayOrder(tx, payment.id, providerId)
        await confirmOrderPayment(tx, queue, {
          id: `pay_${env.E2E_RUN_ID}${index}`,
          orderId: providerId,
          amountPaise: 12345,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
          errorDescription: null,
        })
      })
      orderProducts[project] = {
        gatewayReturnId: '',
        bankReturnId: '',
        returnsBuyerEmail: buyer.email,
        refundOrderId: refundable.order.id,
        sellerEmail: orderSellerEmail,
        otherSellerEmail: orderOtherEmail,
        firstVariantId: first.variant.id,
        secondVariantId: second.variant.id,
        firstTitle: first.product.title,
        secondTitle: second.product.title,
      }
      accounts[project] = { adminEmail, sellerEmail, otherSellerEmail }
      const beforeEarnings = await withContext(db, earningsContext, (tx) =>
        getOwnLedger(tx, earningsContext),
      )
      await addTestLedgerEntries(fixtureDb, orderSeller.id, [
        {
          entryType: 'adjustment',
          amountPaise: -123456789 - beforeEarnings.balancePaise,
          description: 'Earnings fixture opening adjustment',
        },
        ...Array.from({ length: 20 }, (_, count) => ({
          entryType: 'adjustment' as const,
          amountPaise: count % 2 === 0 ? 100 : -100,
          description: `Earnings fixture entry ${count + 1}`,
        })),
      ])
      await withContext(db, context, (tx) =>
        setSellerBankAccount(
          tx,
          loadLedgerConfig(env).encryptionKey,
          context,
          orderSeller.id,
          {
            accountHolder: 'Earnings Test Seller',
            accountNumber: '123456784321',
            ifsc: 'HDFC0001234',
          },
        ),
      )
      // Stable worker states for the statement history UI; no jobs scheduled.
      await fixtureDb.insert(settlementStatements).values([
        {
          sellerId: orderSeller.id,
          requestedBy: admin.id,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-02',
          status: 'processing',
        },
        {
          sellerId: orderSeller.id,
          requestedBy: admin.id,
          periodStart: '2026-01-03',
          periodEnd: '2026-01-04',
          status: 'failed',
          failureReason: 'The test statement file could not be written.',
        },
      ])
      // Frozen test orders, then real payment, delivery and return services.
      const refundBuyer = await createTestUser(fixtureDb)
      const refundProduct = await createTestProduct(fixtureDb, {
        sellerId: seller.id,
        categoryId,
      })
      for (const method of ['razorpay', 'cod'] as const) {
        const ready = await createTestOrderWithLines(fixtureDb, {
          buyerId: refundBuyer.id,
          paymentMethod: method,
          status: method === 'razorpay' ? 'pending_payment' : 'confirmed',
          lines: [
            {
              sellerId: seller.id,
              productId: refundProduct.product.id,
              variantId: refundProduct.variant.id,
              unitPricePaise: 12345,
            },
          ],
        })
        await withContext(db, { role: 'system' }, async (tx) => {
          const payment = await createPayment(tx, {
            orderId: ready.order.id,
            provider: method,
            amountPaise: 12345,
          })
          if (method === 'razorpay') {
            const providerId = `order_return_${env.E2E_RUN_ID}${index}`
            await attachRazorpayOrder(tx, payment.id, providerId)
            await confirmOrderPayment(tx, refundFixtureQueue, {
              id: `pay_return_${env.E2E_RUN_ID}${index}`,
              orderId: providerId,
              amountPaise: 12345,
              currency: 'INR',
              status: 'captured',
              method: 'upi',
              errorDescription: null,
            })
          } else {
            await onOrderConfirmed(
              tx,
              refundFixtureQueue,
              ready.order,
              ready.items,
            )
          }
        })
        const dispatched = await dispatchLines(
          db,
          { queue: refundFixtureQueue, photos: storage },
          {
            role: 'seller',
            userId: seller.ownerUserId,
            sellerId: seller.id,
          },
          ready.order.id,
          {
            lineIds: ready.items.map((item) => item.id),
            courierName: 'Return fixture courier',
            trackingNumber: `RETURN${index}${method}`,
          },
        )
        await markShipmentDelivered(
          db,
          context,
          dispatched.lines[0]!.shipment!.id,
        )
        const requested = await openReturn(
          db,
          { photos: storage },
          { role: 'buyer', userId: refundBuyer.id },
          { orderItemId: ready.items[0]!.id, reasonCode: 'damaged' },
        )
        await approveReturn(db, { photos: storage }, context, requested.id, {
          note: 'Approved for refund review.',
        })
        if (method === 'razorpay')
          orderProducts[project].gatewayReturnId = requested.id
        else orderProducts[project].bankReturnId = requested.id
      }
      for (let count = 0; count < 21; count++) {
        await createTestReturnRequest(fixtureDb, {
          buyerId: buyer.id,
          sellerId: orderSeller.id,
        })
      }
    }
    return { categoryId, accounts, orderProducts, adminMoney }
  } finally {
    await Promise.all([pool.end(), fixturePool.end(), queue.stop()])
  }
}

/** The API walk-through also buys another seller's seeded product. */
export async function prepareDemoFixtures(
  env: NodeJS.ProcessEnv,
  workerUrl: string,
) {
  const webPool = createPool(env.DATABASE_URL!, 'demo-fixtures')
  const workerPool = createPool(workerUrl, 'demo-fixtures-worker')
  try {
    const db = createDatabase(webPool)
    await seedDevelopmentData(db, env)
    await seedExampleProducts(
      {
        db,
        worker: createDatabase(workerPool),
        storage: createObjectStorage(loadStorageConfig(env)),
      },
      env,
    )
  } finally {
    await webPool.end()
    await workerPool.end()
  }
}
