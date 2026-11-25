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
  type RequestContext,
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
} from '@ecokart/core/testing'
import {
  createPayment,
  attachRazorpayOrder,
} from '../../../../packages/core/src/modules/payments/service.ts'

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
  const pool = createPool(env.DATABASE_URL!, 'e2e-fixtures')
  const db = createDatabase(pool)
  const auth = createAppAuth({
    db,
    config: loadAuthConfig(env),
    getQueue: () => {
      throw new Error('Fixture setup must not send messages')
    },
  })
  const directory = createAccountDirectory(auth)
  const accounts: BrowserFixtures['accounts'] = {}
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
      await directory.addRole(orderSeller.ownerUserId, 'buyer')
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
        await createTestOrder(fixtureDb, {
          buyerId: buyer.id,
          lines: [
            {
              sellerId: orderSeller.id,
              productId: first.product.id,
              variantId: first.variant.id,
            },
          ],
        })
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
      for (let count = 0; count < 21; count++) {
        await createTestReturnRequest(fixtureDb, {
          buyerId: buyer.id,
          sellerId: orderSeller.id,
        })
      }
    }
    return { categoryId, accounts, orderProducts }
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
