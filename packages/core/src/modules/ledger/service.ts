import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { sellerLedgerEntries } from '../../db/schema/index.ts'

/*
 * The seller ledger (design doc 5.9): append only, so a seller's balance is
 * the sum of their entries. Payment confirmation writes a sale and a
 * commission entry for every order line (backend spec step 12),
 * cancelling an order reverses them (step 13), and a refunded return takes
 * back its share (step 15).
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

/** A refunded return, as the ledger takes it back from the seller. */
export interface ReturnedLine {
  sellerId: string
  orderId: string
  orderItemId: string
  returnRequestId: string
  orderNumber: string
  title: string
  returnedQuantity: number
  /** What the buyer got back for this return. */
  refundPaise: number
  /** What the buyer paid for the whole line, after its coupon share. */
  linePaidPaise: number
  /** The commission rate frozen on the line, and what it came to. */
  commissionBps: number
  lineCommissionPaise: number
  /** The administrator who recorded the refund. */
  createdBy: string
}

/**
 * Takes back what a refunded return earned its seller (design doc 6.5 step
 * 4): a `refund_reversal` of the refund, and a `commission_reversal` of the
 * commission on it at the rate frozen on the line, rounded down as checkout
 * rounded it. Once the line's refunds reach what was paid for it, the
 * commission reversals add up to exactly its commission. For example on a
 * ₹1,500 line at 10%, refunds of ₹500 and then ₹1,000 give back ₹50 and
 * then the remaining ₹100. Calling it again for the same return writes
 * nothing.
 */
export async function recordReturnReversal(
  tx: Transaction,
  line: ReturnedLine,
): Promise<void> {
  const [done] = await tx
    .select({ id: sellerLedgerEntries.id })
    .from(sellerLedgerEntries)
    .where(eq(sellerLedgerEntries.returnRequestId, line.returnRequestId))
    .limit(1)
  if (done) return

  const [before] = await tx
    .select({
      refundedPaise: sql<string>`coalesce(-sum(${sellerLedgerEntries.amountPaise}) filter (where ${sellerLedgerEntries.entryType} = 'refund_reversal'), 0)`,
      commissionBackPaise: sql<string>`coalesce(sum(${sellerLedgerEntries.amountPaise}) filter (where ${sellerLedgerEntries.entryType} = 'commission_reversal'), 0)`,
    })
    .from(sellerLedgerEntries)
    .where(eq(sellerLedgerEntries.orderItemId, line.orderItemId))
  const refundedBefore = Number(before?.refundedPaise ?? 0)
  const commissionLeft =
    line.lineCommissionPaise - Number(before?.commissionBackPaise ?? 0)
  const commissionBack =
    refundedBefore + line.refundPaise >= line.linePaidPaise
      ? commissionLeft
      : Math.min(
          commissionLeft,
          Math.floor((line.refundPaise * line.commissionBps) / 10_000),
        )

  const common = {
    sellerId: line.sellerId,
    orderId: line.orderId,
    orderItemId: line.orderItemId,
    returnRequestId: line.returnRequestId,
    createdBy: line.createdBy,
  }
  await tx.insert(sellerLedgerEntries).values([
    {
      ...common,
      entryType: 'refund_reversal',
      amountPaise: -line.refundPaise,
      description: `Refund of ${line.returnedQuantity} × ${line.title} returned from order ${line.orderNumber}`,
    },
    ...(commissionBack > 0
      ? [
          {
            ...common,
            entryType: 'commission_reversal',
            amountPaise: commissionBack,
            description: `Commission returned: ${line.returnedQuantity} × ${line.title} returned from order ${line.orderNumber}`,
          },
        ]
      : []),
  ])
}
