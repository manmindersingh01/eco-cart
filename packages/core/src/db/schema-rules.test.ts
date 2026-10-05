import { Client, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { requireEnv } from '../env.ts'

/*
 * Rules from CLAUDE.md and design doc section 5.1, checked against the
 * migrated database itself. A new table or column that forgets one of them
 * fails here instead of in production.
 */

// Tables without buyer or seller data, where the application checks
// permissions (backend spec step 1). Better Auth's four are also here.
const TABLES_WITHOUT_RLS = new Set([
  'users',
  'sessions',
  'accounts',
  'verifications',
  'categories',
  'brands',
  'coupons',
  'platform_settings',
  'content_pages',
  'rate_limits',
])
const BETTER_AUTH_TABLES = new Set([
  'users',
  'sessions',
  'accounts',
  'verifications',
])

const client = new Client({
  connectionString: requireEnv('MIGRATION_DATABASE_URL'),
})

beforeAll(async () => {
  await client.connect()
})

afterAll(async () => {
  await client.end()
})

async function rows<T extends QueryResultRow>(query: string): Promise<T[]> {
  return (await client.query<T>(query)).rows
}

async function publicTables(): Promise<
  { name: string; rls: boolean; forced: boolean }[]
> {
  return rows(`
    select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  `)
}

async function columns(): Promise<
  { table: string; column: string; type: string }[]
> {
  return rows(`
    select table_name as table, column_name as column, data_type as type
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `)
}

describe('schema rules', () => {
  test('the database has all 36 tables from the design', async () => {
    expect(await publicTables()).toHaveLength(36)
  })

  test('every table with buyer or seller data has row-level security', async () => {
    const missing = (await publicTables())
      .filter((table) => !TABLES_WITHOUT_RLS.has(table.name) && !table.rls)
      .map((table) => table.name)
    expect(missing).toEqual([])
  })

  test('every table with row-level security gives the worker full access', async () => {
    const policies = await rows<{ table: string }>(`
      select tablename as table from pg_policies
      where schemaname = 'public' and policyname = 'worker_all'
        and roles = '{ecokart_worker}' and cmd = 'ALL'
        and qual = 'true' and with_check = 'true'
    `)
    const withPolicy = new Set(policies.map((policy) => policy.table))
    const missing = (await publicTables())
      .filter((table) => table.rls && !withPolicy.has(table.name))
      .map((table) => table.name)
    expect(missing).toEqual([])
  })

  test('both database users can read every table', async () => {
    const missing = await rows<{ table: string; role: string }>(`
      select t.relname as table, r.rolname as role
      from pg_class t
      join pg_namespace n on n.oid = t.relnamespace
      cross join (values ('ecokart_web'), ('ecokart_worker')) as r(rolname)
      where n.nspname = 'public' and t.relkind in ('r', 'p')
        and not has_table_privilege(r.rolname, t.oid, 'select')
    `)
    expect(missing).toEqual([])
  })

  test('neither database user can change append-only history', async () => {
    const allowed = await rows<{ table: string; role: string }>(`
      select t as table, r as role
      from unnest(array['seller_ledger_entries', 'order_events', 'audit_logs', 'refunds']) as t,
           unnest(array['ecokart_web', 'ecokart_worker']) as r
      where has_table_privilege(r, 'public.' || t, 'update')
         or has_table_privilege(r, 'public.' || t, 'delete')
    `)
    expect(allowed).toEqual([])
  })

  test('every table has created_at', async () => {
    const all = await columns()
    const withCreatedAt = new Set(
      all.filter((c) => c.column === 'created_at').map((c) => c.table),
    )
    const missing = (await publicTables())
      .map((table) => table.name)
      // payment_events records its creation time as received_at.
      .filter((name) => name !== 'payment_events' && !withCreatedAt.has(name))
    expect(missing).toEqual([])
  })

  test('every updated_at is kept current by a trigger', async () => {
    const triggers = await rows<{ table: string }>(`
      select c.relname as table
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_proc p on p.oid = tg.tgfoid
      join pg_namespace pn on pn.oid = p.pronamespace
      where pn.nspname = 'app' and p.proname = 'set_updated_at'
        and not tg.tgisinternal
    `)
    const withTrigger = new Set(triggers.map((trigger) => trigger.table))
    const missing = (await columns())
      .filter(
        (c) =>
          c.column === 'updated_at' &&
          !BETTER_AUTH_TABLES.has(c.table) &&
          !withTrigger.has(c.table),
      )
      .map((c) => c.table)
    expect(missing).toEqual([])
  })

  test('times are timestamptz outside Better Auth’s tables', async () => {
    const wrong = (await columns())
      .filter(
        (c) =>
          !BETTER_AUTH_TABLES.has(c.table) &&
          c.type === 'timestamp without time zone',
      )
      .map((c) => `${c.table}.${c.column}`)
    expect(wrong).toEqual([])
  })

  test('money is bigint paise and rates are integer basis points', async () => {
    const wrong = (await columns())
      .filter(
        (c) =>
          (c.column.endsWith('_paise') && c.type !== 'bigint') ||
          (c.column.endsWith('_bps') && c.type !== 'integer'),
      )
      .map((c) => `${c.table}.${c.column} is ${c.type}`)
    expect(wrong).toEqual([])
  })

  test('every status column lists its allowed values in a CHECK', async () => {
    const checks = await rows<{ table: string; definition: string }>(`
      select c.relname as table, pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and con.contype = 'c'
    `)
    const missing = (await columns())
      .filter((c) => c.column === 'status')
      .filter(
        (c) =>
          !checks.some(
            (check) =>
              check.table === c.table && check.definition.includes('status'),
          ),
      )
      .map((c) => c.table)
    expect(missing).toEqual([])
  })

  test('no table forces row-level security on its owner', async () => {
    // The owner runs migrations and test fixtures, and the SECURITY DEFINER
    // helper app.is_order_seller relies on the owner not being filtered.
    const forced = (await publicTables())
      .filter((table) => table.forced)
      .map((table) => table.name)
    expect(forced).toEqual([])
  })
})
