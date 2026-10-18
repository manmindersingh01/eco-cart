import type { Transaction } from '../../db/client.ts'
import { sellerLedgerEntries } from '../../db/schema/index.ts'

/*
 * The seller ledger (design doc 5.9): append only, so a seller's balance is
 * the sum of their entries. Payment confirmation writes a sale and a
 * commission entry for every order line (backend spec step 12); step 15 adds
 * reversals, payouts, and adjustments.
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
