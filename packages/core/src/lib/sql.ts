import { getTableName, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * `column` with its table's name, for a subquery that refers to the outer
 * query. In a query on one table Drizzle writes columns without their
 * table, so `orders.id` inside `select ... from payments where order_id =
 * ${orders.id}` would come out as `id` and mean the payment's own id.
 */
export const qualified = (column: AnyPgColumn): SQL =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`
