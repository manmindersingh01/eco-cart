import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { sellerLedgerEntries } from '../../db/schema/index.ts'

/*
 * The seller ledger (design doc 5.9): append only, so a seller's balance is
 * the sum of their entries. Payment confirmation writes a sale and a
 * commission entry for every order line (backend spec step 12), and
 * cancelling an order reverses them (step 13); step 15 adds refunds,
 * payouts, and adjustments.
 */

/** An order line as the ledger records it. */
export interface SoldLine {
  orderId: string
  orderItemId: string
  sellerId: string
  title: string
  quantity: number
  lineTotalPaise: number
  discountSharePaise: number
  commissionBps: number
  commissionPaise: number
}

/**
 * The money each line earns its seller (the line total after its share of
 * the coupon) and the commission taken from it (design doc section 11:
 * commission is on the line after its discount share). An entry of nothing,
 * such as a line made free by a coupon, is left out.
 */
export async function recordSales(
  tx: Transaction,
  orderNumber: string,
  lines: SoldLine[],
): Promise<void> {
  const entries = lines.flatMap((line) => {
    const salePaise = line.lineTotalPaise - line.discountSharePaise
    const common = {
      sellerId: line.sellerId,
      orderId: line.orderId,
      orderItemId: line.orderItemId,
    }
    return [
      ...(salePaise > 0
        ? [
            {
              ...common,
              entryType: 'sale',
              amountPaise: salePaise,
              description: `Sale of ${line.quantity} × ${line.title} on order ${orderNumber}`,
            },
          ]
        : []),
      ...(line.commissionPaise > 0
        ? [
            {
              ...common,
              entryType: 'commission',
              amountPaise: -line.commissionPaise,
              description: `Commission at ${line.commissionBps / 100}% on order ${orderNumber}`,
            },
          ]
        : []),
    ]
  })
  if (entries.length > 0) await tx.insert(sellerLedgerEntries).values(entries)
}

/**
 * Takes back what an order's lines earned their sellers, for an order
 * cancelled before dispatch: a `refund_reversal` of each line's sales and a
 * `commission_reversal` of its commission. It reverses the entries as they
 * stand, so calling it again writes nothing, and an order that never earned
 * anything (one that was never paid) gets no entries.
 */
export async function reverseSales(
  tx: Transaction,
  orderId: string,
  orderNumber: string,
): Promise<void> {
  const balances = await tx
    .select({
      sellerId: sellerLedgerEntries.sellerId,
      orderItemId: sellerLedgerEntries.orderItemId,
      salePaise: sql<string>`coalesce(sum(${sellerLedgerEntries.amountPaise}) filter (where ${sellerLedgerEntries.entryType} in ('sale', 'refund_reversal')), 0)`,
      commissionPaise: sql<string>`coalesce(sum(${sellerLedgerEntries.amountPaise}) filter (where ${sellerLedgerEntries.entryType} in ('commission', 'commission_reversal')), 0)`,
    })
    .from(sellerLedgerEntries)
    .where(
      and(
        eq(sellerLedgerEntries.orderId, orderId),
        inArray(sellerLedgerEntries.entryType, [
          'sale',
          'refund_reversal',
          'commission',
          'commission_reversal',
        ]),
      ),
    )
    .groupBy(sellerLedgerEntries.sellerId, sellerLedgerEntries.orderItemId)
  const entries = balances.flatMap((line) => {
    const sale = Number(line.salePaise)
    const commission = Number(line.commissionPaise)
    const common = {
      sellerId: line.sellerId,
      orderId,
      orderItemId: line.orderItemId,
    }
    return [
      ...(sale > 0
        ? [
            {
              ...common,
              entryType: 'refund_reversal',
              amountPaise: -sale,
              description: `Order ${orderNumber} cancelled before dispatch`,
            },
          ]
        : []),
      ...(commission < 0
        ? [
            {
              ...common,
              entryType: 'commission_reversal',
              amountPaise: -commission,
              description: `Commission returned: order ${orderNumber} cancelled before dispatch`,
            },
          ]
        : []),
    ]
  })
  if (entries.length > 0) await tx.insert(sellerLedgerEntries).values(entries)
}
