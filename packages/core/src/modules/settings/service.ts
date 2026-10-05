import { eq } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { platformSettings } from '../../db/schema/index.ts'
import {
  ForbiddenError,
  NotConfiguredError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { describeIssues } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import {
  isSettingKey,
  settingDefinitions,
  settingKeys,
  type SettingKey,
  type SettingValue,
} from './definitions.ts'

/** A setting as the admin console shows it. */
export interface SettingView {
  key: SettingKey
  description: string
  /** Null when the setting is missing. */
  value: unknown
  /** Saved by an administrator, the built-in default, or not set at all. */
  source: 'saved' | 'default' | 'missing'
  updatedAt: Date | null
  updatedBy: string | null
}

function parseSaved<K extends SettingKey>(
  key: K,
  saved: unknown,
): SettingValue<K> {
  const result = settingDefinitions[key].schema.safeParse(saved)
  if (!result.success) {
    // Only a hand-edited row can get here; refuse it rather than let a bad
    // value reach checkout.
    throw new Error(
      `The saved value of ${key} is invalid: ${describeIssues(result.error).join('; ')}`,
    )
  }
  return result.data
}

const defaultOf = <K extends SettingKey>(key: K): SettingValue<K> | undefined =>
  settingDefinitions[key].default

/**
 * The value of one setting: the saved one, or the default. Throws
 * NotConfiguredError for a setting the client must decide that nobody has
 * saved yet, so for example checkout stops instead of guessing a delivery
 * charge.
 */
export async function getSetting<K extends SettingKey>(
  tx: Transaction,
  key: K,
): Promise<SettingValue<K>> {
  const [row] = await tx
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
  if (row) return parseSaved(key, row.value)
  const fallback = defaultOf(key)
  if (fallback !== undefined) return fallback
  throw new NotConfiguredError(
    `The platform setting ${key} has not been configured yet`,
  )
}

function assertCanManageSettings(context: RequestContext): void {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can manage platform settings')
  }
}

/** Every setting with where its value comes from. Administrators only. */
export async function listSettings(
  tx: Transaction,
  context: RequestContext,
): Promise<SettingView[]> {
  assertCanManageSettings(context)
  const rows = await tx.select().from(platformSettings)
  const saved = new Map(rows.map((row) => [row.key, row]))
  return settingKeys.map((key) => {
    const row = saved.get(key)
    const fallback = defaultOf(key)
    return {
      key,
      description: settingDefinitions[key].description,
      value: row ? parseSaved(key, row.value) : (fallback ?? null),
      source: row ? 'saved' : fallback !== undefined ? 'default' : 'missing',
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    }
  })
}

/**
 * Saves one setting after checking it against its rule, and writes the
 * change to audit_logs in the same transaction. Administrators only (and the
 * system, for the development seed).
 */
export async function updateSetting(
  tx: Transaction,
  context: RequestContext,
  key: string,
  value: unknown,
  ip?: string | null,
): Promise<SettingView> {
  assertCanManageSettings(context)
  if (!isSettingKey(key)) {
    throw new NotFoundError(`There is no platform setting called ${key}`)
  }
  const result = settingDefinitions[key].schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(
      `That value is not allowed for ${key}`,
      describeIssues(result.error),
    )
  }

  // Locks the current row, so the audit entry's "before" is the value this
  // change actually replaced.
  const [previous] = await tx
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .for('update')
  const userId = 'userId' in context ? (context.userId ?? null) : null

  const [row] = await tx
    .insert(platformSettings)
    .values({ key, value: result.data, updatedBy: userId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: result.data, updatedBy: userId },
    })
    .returning()

  await recordAuditEntry(tx, {
    actorUserId: userId,
    actorRole: context.role === 'admin' ? 'admin' : 'system',
    action: 'settings.update',
    entityType: 'platform_setting',
    entityId: key,
    before: previous?.value ?? null,
    after: result.data,
    ip,
  })

  return {
    key,
    description: settingDefinitions[key].description,
    value: result.data,
    source: 'saved',
    updatedAt: row!.updatedAt,
    updatedBy: row!.updatedBy,
  }
}
