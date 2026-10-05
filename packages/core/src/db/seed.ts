import { randomBytes } from 'node:crypto'
import { requireEnv } from '../env.ts'
import { createAccountDirectory } from '../modules/auth/accounts.ts'
import { createAppAuth } from '../modules/auth/service.ts'
import { approveSeller, createSeller } from '../modules/sellers/service.ts'
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
  }
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

if (import.meta.main) {
  const pool = createPool(requireEnv('DATABASE_URL'), 'ecokart-seed')
  try {
    const { settings, sellers } = await seedDevelopmentData(
      createDatabase(pool),
    )
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
  } catch (error) {
    console.error('Seeding failed', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
