import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import {
  ConflictError,
  ForbiddenError,
  TooManyRequestsError,
  UnavailableError,
} from '../../errors.ts'
import { formatRupees } from '../../lib/money.ts'
import type { JobQueue } from '../../lib/queue.ts'
import type { Razorpay } from '../../lib/razorpay.ts'
import { idOf, paise, parseInput, strictObject } from '../../lib/validation.ts'
import { getShippingAddress } from '../addresses/service.ts'
import {
  couponProblem,
  couponTerms,
  findCouponByCode,
  takeCouponUse,
  type CouponRow,
} from '../cart/coupons.ts'
import {
  backCalculateTax,
  couponDiscount,
  deliveryCharge,
  splitDiscount,
} from '../cart/pricing.ts'
import {
  cartForCheckout,
  emptyCart,
  lineProblem,
  restoreCart,
  type CartForCheckout,
} from '../cart/service.ts'
import {
  lockStock,
  readPurchasableVariants,
  takeStock,
} from '../catalogue/stock.ts'
import { consumeRateLimit } from '../rate-limits/service.ts'
import { countOrdersAwaitingPayment } from '../orders/queries.ts'
import {
  cancelUnpaidOrder,
  createOrder,
  nextOrderNumber,
  onOrderConfirmed,
  type OrderRow,
} from '../orders/service.ts'
import {
  attachRazorpayOrder,
  createPayment,
  failPayment,
} from '../payments/service.ts'
import { getCommissionRates } from '../sellers/service.ts'
import { getSetting } from '../settings/service.ts'

/*
 * Checkout (design doc 6.3, backend spec step 12): the cart becomes an
 * order in one transaction that reads prices and stock fresh, takes the
 * stock and the coupon use with conditional updates, and freezes every
 * snapshot. An online payment's Razorpay order is created only after that
 * transaction commits, so a slow gateway never holds a database lock.
 */

type Buyer = Extract<RequestContext, { role: 'buyer' }>

/** Checkouts one buyer may start in an hour. */
export const CHECKOUTS_PER_HOUR = 10

/**
 * Online orders one buyer may leave waiting for payment, so nobody can hold
 * stock back from other buyers by starting orders they never pay.
 */
export const MAX_ORDERS_AWAITING_PAYMENT = 3

/** Razorpay's smallest payment, and so the smallest order. */
const MIN_ORDER_PAISE = 100

const checkoutRequest = strictObject({
  addressId: idOf('a saved address'),
  paymentMethod: z.enum(['razorpay', 'cod']),
  /**
   * The total the buyer was shown. When the price has changed since, the
   * order is refused, so nobody pays an amount they did not see.
   */
  expectedTotalPaise: paise.optional(),
})

/** The buyer's account, as their session holds it. */
export interface BuyerAccount {
  name: string
  /** Null for a phone-only account. */
  email: string | null
  phoneNumber: string | null
}

export interface PlacedOrder {
  order: {
    id: string
    orderNumber: string
    status: 'pending_payment' | 'confirmed'
    paymentMethod: 'razorpay' | 'cod'
    totalPaise: number
  }
  /** What the browser opens Razorpay's checkout with; null for cash on delivery. */
  payment: {
    provider: 'razorpay'
    keyId: string
    razorpayOrderId: string
    amountPaise: number
    currency: 'INR'
    prefill: { name: string; email: string | null; contact: string }
  } | null
}

/** Which ways to pay are open right now, for the checkout page. */
export async function checkoutOptions(
  tx: Transaction,
  razorpay: Razorpay | null,
): Promise<{ cashOnDelivery: boolean; online: { keyId: string } | null }> {
  return {
    cashOnDelivery: await getSetting(tx, 'cod_enabled'),
    online: razorpay ? { keyId: razorpay.keyId } : null,
  }
}

/**
 * Places the signed-in buyer's cart as an order, to be paid online or on
 * delivery. Cash on delivery is confirmed at once; an online order waits
 * for its payment, which the browser makes on Razorpay's checkout with the
 * answer's `payment`.
 */
export async function placeOrder(
  db: Database,
  deps: { queue: JobQueue; razorpay: Razorpay | null },
  context: RequestContext,
  account: BuyerAccount,
  input: unknown,
): Promise<PlacedOrder> {
  if (context.role !== 'buyer') {
    throw new ForbiddenError('This needs a buyer account')
  }
  const request = parseInput(
    checkoutRequest,
    input,
    'Those checkout details are not valid',
  )
  const attempts = await consumeRateLimit(db, {
    key: `checkout:${context.userId}`,
    limit: CHECKOUTS_PER_HOUR,
    windowSeconds: 3600,
  })
  if (!attempts.allowed) {
    throw new TooManyRequestsError(
      'Too many orders started; please try again later',
      { resetAt: attempts.resetAt },
    )
  }
  const razorpay = request.paymentMethod === 'razorpay' ? deps.razorpay : null
  if (request.paymentMethod === 'razorpay' && !razorpay) {
    throw new ConflictError(
      'Online payment is not available yet; please choose cash on delivery',
    )
  }

  // Checkout changes several parties' data at once (stock, coupons, the
  // sellers' ledgers and invoice numbers), so it runs as `system` after the
  // checks above (design doc 8).
  const system: RequestContext = { role: 'system', userId: context.userId }
  const placed = await withContext(db, system, (tx) =>
    takeOrder(tx, deps.queue, context, account, request),
  )
  const order = {
    id: placed.order.id,
    orderNumber: placed.order.orderNumber,
    status:
      placed.order.status === 'confirmed' ? 'confirmed' : 'pending_payment',
    paymentMethod: request.paymentMethod,
    totalPaise: placed.order.totalPaise,
  } as const
  if (!razorpay) return { order, payment: null }

  let razorpayOrderId: string
  try {
    razorpayOrderId = (
      await razorpay.createOrder({
        amountPaise: placed.order.totalPaise,
        receipt: placed.order.orderNumber,
        notes: {
          orderId: placed.order.id,
          orderNumber: placed.order.orderNumber,
        },
      })
    ).id
  } catch (error) {
    // The compensating transaction (design doc 6.3 step 4).
    const reason = 'Online payment could not be started'
    await withContext(db, system, async (tx) => {
      if (await cancelUnpaidOrder(tx, placed.order.id, reason)) {
        await failPayment(tx, placed.order.id, reason)
        await restoreCart(tx, context.userId, placed.cart)
      }
    })
    console.error(
      `Razorpay order for ${placed.order.orderNumber} failed:`,
      error instanceof Error ? error.message : error,
    )
    throw new UnavailableError(
      'Online payment could not be started. Your cart is as it was; please try again, or choose cash on delivery.',
    )
  }
  await withContext(db, system, (tx) =>
    attachRazorpayOrder(tx, placed.paymentId, razorpayOrderId),
  )
  return {
    order,
    payment: {
      provider: 'razorpay',
      keyId: razorpay.keyId,
      razorpayOrderId,
      amountPaise: placed.order.totalPaise,
      currency: 'INR',
      prefill: {
        name: placed.order.buyerName,
        email: placed.order.buyerEmail,
        contact: placed.order.buyerPhone,
      },
    },
  }
}

/** The order transaction itself (design doc 6.3 step 2). */
async function takeOrder(
  tx: Transaction,
  queue: JobQueue,
  buyer: Buyer,
  account: BuyerAccount,
  request: z.output<typeof checkoutRequest>,
): Promise<{ order: OrderRow; paymentId: string; cart: CartForCheckout }> {
  const { userId } = buyer
  if (
    request.paymentMethod === 'razorpay' &&
    (await countOrdersAwaitingPayment(tx, userId)) >=
      MAX_ORDERS_AWAITING_PAYMENT
  ) {
    throw new ConflictError(
      `You have ${MAX_ORDERS_AWAITING_PAYMENT} orders waiting for payment; please pay for one, or wait until it expires`,
    )
  }
  if (
    request.paymentMethod === 'cod' &&
    !(await getSetting(tx, 'cod_enabled'))
  ) {
    throw new ConflictError(
      'Cash on delivery is not available right now; please pay online',
    )
  }
  const cart = await cartForCheckout(tx, buyer)
  if (!cart) throw new ConflictError('Your cart is empty')
  const address = await getShippingAddress(tx, userId, request.addressId)

  // Product rows first, then variants, as every stock change locks them.
  const variantIds = cart.items.map((item) => item.variantId)
  await lockStock(tx, variantIds)
  const variants = await readPurchasableVariants(tx, variantIds)
  const problem = cart.items
    .map((item) => lineProblem(variants.get(item.variantId), item.quantity))
    .find((found) => found !== null)
  if (problem) throw new ConflictError(`${problem}. Please review your cart.`)
  const lines = cart.items.map((item) => ({
    quantity: item.quantity,
    variant: variants.get(item.variantId)!,
  }))

  const lineTotals = lines.map(
    (line) => line.variant.pricePaise * line.quantity,
  )
  const subtotalPaise = lineTotals.reduce((sum, total) => sum + total, 0)
  let coupon: CouponRow | null = null
  let discountPaise = 0
  if (cart.couponCode !== null) {
    coupon = await findCouponByCode(tx, cart.couponCode)
    const couponIssue = coupon
      ? await couponProblem(tx, coupon, { subtotalPaise, userId })
      : 'This coupon is no longer active'
    if (couponIssue) {
      throw new ConflictError(
        `${couponIssue}. Remove the coupon or change your cart.`,
      )
    }
    discountPaise = couponDiscount(couponTerms(coupon!), subtotalPaise)
  }
  const shares = splitDiscount(lineTotals, discountPaise)
  const deliveryPaise = deliveryCharge(subtotalPaise - discountPaise, {
    chargePaise: await getSetting(tx, 'delivery_charge_paise'),
    freeFromPaise: await getSetting(tx, 'free_delivery_threshold_paise'),
  })
  const totalPaise = subtotalPaise - discountPaise + deliveryPaise
  if (
    request.expectedTotalPaise !== undefined &&
    request.expectedTotalPaise !== totalPaise
  ) {
    throw new ConflictError(
      `Your total is now ${formatRupees(totalPaise)}, not ${formatRupees(request.expectedTotalPaise)}; please review your cart`,
    )
  }
  if (totalPaise < MIN_ORDER_PAISE) {
    throw new ConflictError(
      `An order must come to at least ${formatRupees(MIN_ORDER_PAISE)}`,
    )
  }

  const platformRate = await getSetting(tx, 'commission_bps')
  const sellerRates = await getCommissionRates(
    tx,
    lines.map((line) => line.variant.sellerId),
  )
  const items = lines.map((line, index) => {
    const { variant } = line
    const lineTotalPaise = lineTotals[index]!
    const discountSharePaise = shares[index]!
    const net = lineTotalPaise - discountSharePaise
    const commissionBps = sellerRates.get(variant.sellerId) ?? platformRate
    return {
      sellerId: variant.sellerId,
      productId: variant.productId,
      variantId: variant.variantId,
      title: variant.title,
      sku: variant.sku,
      options: variant.options,
      imageKey: variant.imageKey,
      // Present on every product for sale (readPurchasableVariants).
      hsnCode: variant.hsnCode!,
      gstRateBps: variant.gstRateBps!,
      unitPricePaise: variant.pricePaise,
      unitMrpPaise: variant.mrpPaise,
      quantity: line.quantity,
      lineTotalPaise,
      discountSharePaise,
      ...backCalculateTax(net, variant.gstRateBps!),
      commissionBps,
      commissionPaise: Math.floor((net * commissionBps) / 10_000),
    }
  })

  const short = await takeStock(
    tx,
    lines.map((line) => ({
      productId: line.variant.productId,
      variantId: line.variant.variantId,
      quantity: line.quantity,
    })),
  )
  if (short.length > 0) {
    throw new ConflictError(
      'An item sold out just now. Please review your cart.',
    )
  }
  if (coupon && !(await takeCouponUse(tx, coupon.id))) {
    throw new ConflictError(
      'This coupon has been used up. Remove the coupon to place your order.',
    )
  }

  const placedAt = new Date()
  const status =
    request.paymentMethod === 'cod' ? 'confirmed' : 'pending_payment'
  const { order, items: rows } = await createOrder(tx, {
    orderNumber: await nextOrderNumber(tx, placedAt),
    userId,
    status,
    paymentMethod: request.paymentMethod,
    subtotalPaise,
    discountPaise,
    deliveryPaise,
    taxPaise: items.reduce((sum, item) => sum + item.taxPaise, 0),
    totalPaise,
    couponId: coupon?.id ?? null,
    couponCode: coupon?.code ?? null,
    shippingAddress: address,
    buyerName: account.name.trim() || address.fullName,
    buyerPhone: account.phoneNumber ?? address.phone,
    buyerEmail: account.email,
    placedAt,
    items,
  })
  const payment = await createPayment(tx, {
    orderId: order.id,
    provider: request.paymentMethod,
    amountPaise: totalPaise,
  })
  await emptyCart(tx, cart.cartId)
  if (status === 'confirmed') await onOrderConfirmed(tx, queue, order, rows)
  return { order, paymentId: payment.id, cart }
}
