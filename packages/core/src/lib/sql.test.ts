import { drizzle } from 'drizzle-orm/node-postgres'
import { describe, expect, test } from 'vitest'
import { orders, products } from '../db/schema/index.ts'
import {
  hasCapturedOnlinePayment,
  latestPaymentStatus,
} from '../modules/payments/service.ts'
import { sellerIsApproved } from '../modules/sellers/service.ts'
import { qualified } from './sql.ts'

/*
 * In the selected columns of a query on one table Drizzle writes columns
 * without their table, so a subquery there that compares its own column
 * with the outer query's must name the outer table, or `id` would mean the
 * subquery's own id. These check the SQL itself, because a wrong subquery
 * can still give the right answer by luck when the inner table has no
 * column of that name.
 */

const db = drizzle.mock()

describe('qualified', () => {
  test('names the column with its table, even among selected columns', () => {
    const query = db
      .select({ id: orders.id, same: qualified(orders.id) })
      .from(orders)
    expect(query.toSQL().sql).toBe('select "id", "orders"."id" from "orders"')
  })
})

describe('subqueries on another table, selected as columns', () => {
  test('name the outer table of the column they compare with', () => {
    const onProducts = db
      .select({
        id: products.id,
        approved: sellerIsApproved(products.sellerId),
      })
      .from(products)
      .toSQL().sql
    expect(onProducts).toContain('= "products"."seller_id"')

    const onOrders = db
      .select({
        id: orders.id,
        payment: latestPaymentStatus(orders.id),
        paid: hasCapturedOnlinePayment(orders.id),
      })
      .from(orders)
      .toSQL().sql
    expect(onOrders.match(/= "orders"\."id"/g)).toHaveLength(2)
  })
})
