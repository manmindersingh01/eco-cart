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
  type RequestContext,
} from '@ecokart/core'
import {
  DEVELOPMENT_SETTINGS,
  seedDevelopmentData,
  seedExampleProducts,
} from '../../../../packages/core/src/db/seed.ts'

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
  accounts: Record<
    string,
    { sellerEmail: string; adminEmail: string; otherSellerEmail: string }
  >
}

export async function prepareFixtures(
  env: NodeJS.ProcessEnv,
): Promise<BrowserFixtures> {
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
  let categoryId = ''
  try {
    const projects = [...browserProjects, 'chrome-desktop', 'chrome-phone']
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
      accounts[project] = { adminEmail, sellerEmail, otherSellerEmail }
    }
    return { categoryId, accounts }
  } finally {
    await pool.end()
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
