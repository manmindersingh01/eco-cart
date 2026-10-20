import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { sellerLedgerEntries } from '../../db/schema/index.ts'
import { ConflictError } from '../../errors.ts'
import { formatRupees } from '../../lib/money.ts'

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
  /** The administrator who recorded the refund. */
  createdBy: string
}

/** The sum of one kind of entry, as exact text. */
const totalOf = (entryType: string) =>
  sql<string>`coalesce(sum(${sellerLedgerEntries.amountPaise}) filter (where ${eq(sellerLedgerEntries.entryType, entryType)}), 0)`

/** `numerator / denominator`, rounded half up, in exact whole numbers. */
function roundedShare(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n))
}

/**
 * Takes back what a refunded return earned its seller (design doc 6.5 step
 * 4): a `refund_reversal` of the refund, and a `commission_reversal` of
 * the commission on it, worked out from the line's own sale and commission
 * entries, which used the rate frozen on the line. The share is counted
 * over everything refunded on the line so far, so partial returns never
 * drift, and the refund that empties the line gives back exactly its
 * commission. For example on a ₹1,500 line whose commission was ₹150,
 * refunds of ₹500 and then ₹1,000 give back ₹50 and then ₹100. Calling it
 * again for the same return writes nothing; the caller holds the order's
 * lock, which keeps that check safe.
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

  const [entries] = await tx
    .select({
      sale: totalOf('sale'),
      refunded: totalOf('refund_reversal'),
      commission: totalOf('commission'),
      commissionBack: totalOf('commission_reversal'),
    })
    .from(sellerLedgerEntries)
    .where(eq(sellerLedgerEntries.orderItemId, line.orderItemId))
  const sale = BigInt(entries?.sale ?? '0')
  const refundedBefore = -BigInt(entries?.refunded ?? '0')
  const refundedNow = refundedBefore + BigInt(line.refundPaise)
  if (refundedNow > sale) {
    throw new ConflictError(
      `Only ${formatRupees(Number(sale - refundedBefore))} of ${line.title} on order ${line.orderNumber} is left to refund`,
    )
  }
  const commission = -BigInt(entries?.commission ?? '0')
  const commissionBack =
    roundedShare(commission * refundedNow, sale) -
    Number(entries?.commissionBack ?? '0')

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
