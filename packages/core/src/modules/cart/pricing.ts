/*
 * The arithmetic of a cart and an order, in whole paise (design doc 5.1 and
 * 6.3). The cart shows it and checkout freezes it onto the order, so both
 * use these functions and can never disagree.
 */

/** A coupon's terms, as `couponDiscount` needs them. */
export interface CouponTerms {
  discountType: 'percent' | 'fixed'
  /** Basis points for percent coupons, paise for fixed ones. */
  discountValue: number
  maxDiscountPaise: number | null
}

/**
 * The discount a coupon gives on `subtotalPaise`: a percentage rounded down
 * to the paisa and capped at the coupon's maximum, or a fixed amount, and
 * never more than the subtotal. For example 10% off ₹1,299 is ₹129.90.
 */
export function couponDiscount(
  coupon: CouponTerms,
  subtotalPaise: number,
): number {
  const raw =
    coupon.discountType === 'percent'
      ? Math.floor((subtotalPaise * coupon.discountValue) / 10_000)
      : coupon.discountValue
  const capped =
    coupon.maxDiscountPaise === null
      ? raw
      : Math.min(raw, coupon.maxDiscountPaise)
  return Math.max(0, Math.min(capped, subtotalPaise))
}

export interface DeliveryRules {
  chargePaise: number
  /** Orders whose items come to at least this ship free. */
  freeFromPaise: number
}

/**
 * The delivery charge: free when the items, after the coupon, come to at
 * least the free-delivery threshold, and nothing for an empty order.
 */
export function deliveryCharge(
  itemsPaise: number,
  rules: DeliveryRules,
): number {
  if (itemsPaise <= 0) return 0
  return itemsPaise >= rules.freeFromPaise ? 0 : rules.chargePaise
}

/**
 * Splits `discountPaise` over lines in proportion to their totals, so each
 * order line knows its share (`order_items.discount_share_paise`). Shares
 * are rounded down, and the paise left over go one each to the lines with
 * the largest remainders, earlier lines first on a tie, so the shares always
 * add up to the discount exactly.
 */
export function splitDiscount(
  lineTotalsPaise: number[],
  discountPaise: number,
): number[] {
  const total = lineTotalsPaise.reduce((sum, line) => sum + line, 0)
  if (discountPaise <= 0 || total <= 0) return lineTotalsPaise.map(() => 0)
  if (discountPaise > total) {
    throw new Error(
      'A discount cannot be larger than the lines it is split over',
    )
  }
  const shares = lineTotalsPaise.map((line) =>
    Math.floor((line * discountPaise) / total),
  )
  let left = discountPaise - shares.reduce((sum, share) => sum + share, 0)
  const byRemainder = lineTotalsPaise
    .map((line, index) => ({
      index,
      remainder: (line * discountPaise) % total,
    }))
    .toSorted((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of byRemainder) {
    if (left === 0) break
    shares[index]! += 1
    left -= 1
  }
  return shares
}

/**
 * GST back-calculated from a tax-inclusive amount (design doc 5.1): the
 * taxable value rounded to the paisa, and the tax as the rest, so the two
 * always add up to the amount. For example ₹500 at 18% is ₹423.73 plus
 * ₹76.27 tax.
 */
export function backCalculateTax(
  amountPaise: number,
  gstRateBps: number,
): { taxablePaise: number; taxPaise: number } {
  const taxablePaise = Math.round(
    (amountPaise * 10_000) / (10_000 + gstRateBps),
  )
  return { taxablePaise, taxPaise: amountPaise - taxablePaise }
}
