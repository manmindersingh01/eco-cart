import { requireEnv } from '../env.ts'
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

/**
 * Fills in example data for local development (`pnpm db:seed`). It only adds
 * what is missing, never overwrites a saved value, goes through the same
 * services as the app, and refuses to run in production.
 */
export async function seedDevelopmentData(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SettingKey[]> {
  if (env.NODE_ENV === 'production') {
    throw new Error('The development seed never runs in production')
  }
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
    const filled = await seedDevelopmentData(createDatabase(pool))
    console.info(
      filled.length === 0
        ? 'Nothing to seed: every example setting already has a saved value'
        : `Saved example values for: ${filled.join(', ')}`,
    )
  } catch (error) {
    console.error('Seeding failed', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
