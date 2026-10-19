import { formatRupees as rupees } from '../../lib/money.ts'
import { stateName } from '../../lib/states.ts'
import type { EmailOtpPurpose } from './types.ts'

/*
 * Message wording. Plain text is the main form; the HTML version carries the
 * same words. Every value put into HTML is escaped.
 */

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const minutesUntil = (expiresAt: Date, now: Date) =>
  Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 60_000))

export function otpEmailSubject(purpose: EmailOtpPurpose): string {
  return purpose === 'sign-in'
    ? 'Your EcoKart sign-in code'
    : 'Your EcoKart verification code'
}

export function renderOtpEmail(
  code: string,
  expiresAt: Date,
  now: Date,
): { text: string; html: string } {
  const minutes = minutesUntil(expiresAt, now)
  const lines = [
    `Your EcoKart code is ${code}.`,
    `It works once and expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    'If you did not ask for it, you can ignore this email.',
    'Never share this code with anyone, including anyone who says they are from EcoKart.',
  ]
  return {
    text: lines.join('\n\n'),
    html: [
      `<p>Your EcoKart code is</p>`,
      `<p style="font-size:28px;font-weight:600;letter-spacing:4px">${escapeHtml(code)}</p>`,
      ...lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`),
    ].join('\n'),
  }
}

/** Kept short: one SMS segment. The DLT template must match it exactly. */
export function renderOtpSms(code: string, expiresAt: Date, now: Date): string {
  const minutes = minutesUntil(expiresAt, now)
  return `${code} is your EcoKart code. It expires in ${minutes} min. Do not share it with anyone.`
}

// Order emails (backend spec steps 12 and 13).

const orderDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

const asHtml = (lines: string[]) =>
  lines
    .map((line) =>
      line === '' ? '' : `<p>${escapeHtml(line).replaceAll('\n', '<br>')}</p>`,
    )
    .filter(Boolean)
    .join('\n')

export function orderPlacedSubject(orderNumber: string): string {
  return `Your EcoKart order ${orderNumber} is placed`
}

export function renderOrderPlacedEmail(order: {
  orderNumber: string
  buyerName: string
  placedAt: string
  paymentMethod: 'razorpay' | 'cod'
  lines: {
    title: string
    options: Record<string, string>
    quantity: number
    lineTotalPaise: number
  }[]
  subtotalPaise: number
  discountPaise: number
  deliveryPaise: number
  totalPaise: number
  shippingAddress: {
    fullName: string
    line1: string
    line2: string | null
    landmark: string | null
    city: string
    stateCode: string
    pincode: string
    phone: string
  }
}): { text: string; html: string } {
  const address = order.shippingAddress
  const items = order.lines.map((line) => {
    const options = Object.values(line.options)
    const name = options.length
      ? `${line.title} (${options.join(', ')})`
      : line.title
    return `${name} × ${line.quantity}: ${rupees(line.lineTotalPaise)}`
  })
  const lines = [
    `Hello ${order.buyerName || address.fullName},`,
    `Thank you for your order ${order.orderNumber}, placed on ${orderDate.format(new Date(order.placedAt))}.`,
    items.join('\n'),
    [
      `Items: ${rupees(order.subtotalPaise)}`,
      ...(order.discountPaise > 0
        ? [`Coupon: -${rupees(order.discountPaise)}`]
        : []),
      `Delivery: ${order.deliveryPaise > 0 ? rupees(order.deliveryPaise) : 'Free'}`,
      `Total: ${rupees(order.totalPaise)}`,
    ].join('\n'),
    order.paymentMethod === 'cod'
      ? 'Please keep the total ready in cash for the delivery.'
      : 'Your payment is received.',
    [
      'Delivering to:',
      address.fullName,
      address.line1,
      ...(address.line2 ? [address.line2] : []),
      ...(address.landmark ? [address.landmark] : []),
      `${address.city}, ${stateName(address.stateCode) ?? address.stateCode} ${address.pincode}`,
      `Phone: ${address.phone}`,
    ].join('\n'),
    'We will email you again when your items are dispatched.',
  ]
  return { text: lines.join('\n\n'), html: asHtml(lines) }
}

export function paymentReceivedSubject(orderNumber: string): string {
  return `Payment received for order ${orderNumber}`
}

/** Razorpay's payment methods, as a buyer would say them. */
const PAYMENT_METHODS: Record<string, string> = {
  upi: 'UPI',
  card: 'card',
  netbanking: 'net banking',
  wallet: 'wallet',
  emi: 'EMI',
  paylater: 'pay later',
}

export function renderPaymentReceivedEmail(payment: {
  orderNumber: string
  amountPaise: number
  method: string | null
  paidAt: string
}): { text: string; html: string } {
  const method = payment.method && PAYMENT_METHODS[payment.method]
  const lines = [
    `We have received your payment of ${rupees(payment.amountPaise)} for order ${payment.orderNumber} on ${orderDate.format(new Date(payment.paidAt))}${method ? ` by ${method}` : ''}.`,
    'Your invoice will be ready to download from your order shortly.',
  ]
  return { text: lines.join('\n\n'), html: asHtml(lines) }
}

const lineName = (line: {
  title: string
  options: Record<string, string>
  quantity: number
}) => {
  const options = Object.values(line.options)
  const name = options.length
    ? `${line.title} (${options.join(', ')})`
    : line.title
  return `${name} × ${line.quantity}`
}

export function dispatchedSubject(orderNumber: string): string {
  return `Your EcoKart order ${orderNumber} is on its way`
}

export function renderDispatchedEmail(shipment: {
  orderNumber: string
  buyerName: string
  lines: { title: string; options: Record<string, string>; quantity: number }[]
  courierName: string
  trackingNumber: string
  trackingUrl: string | null
  wholeOrder: boolean
  firstParcel: boolean
}): { text: string; html: string } {
  const lines = [
    `Hello ${shipment.buyerName},`,
    !shipment.wholeOrder
      ? `Part of your order ${shipment.orderNumber} is on its way. We will email you again when the rest is dispatched.`
      : shipment.firstParcel
        ? `Your order ${shipment.orderNumber} is on its way.`
        : `The rest of your order ${shipment.orderNumber} is on its way.`,
    shipment.lines.map(lineName).join('\n'),
    [
      `Courier: ${shipment.courierName}`,
      `Tracking number: ${shipment.trackingNumber}`,
      ...(shipment.trackingUrl ? [`Track it: ${shipment.trackingUrl}`] : []),
    ].join('\n'),
    'Thank you for shopping with EcoKart.',
  ]
  return { text: lines.join('\n\n'), html: asHtml(lines) }
}

export function cancelledSubject(orderNumber: string): string {
  return `Your EcoKart order ${orderNumber} is cancelled`
}

export function renderCancelledEmail(order: {
  orderNumber: string
  buyerName: string
  placedAt: string
  cancelledBy: 'buyer' | 'ecokart'
  reason: string
  lines: { title: string; options: Record<string, string>; quantity: number }[]
  money: { kind: 'refund'; amountPaise: number } | { kind: 'nothing_charged' }
}): { text: string; html: string } {
  const placed = orderDate.format(new Date(order.placedAt))
  const lines = [
    `Hello ${order.buyerName},`,
    order.cancelledBy === 'buyer'
      ? `As you asked, your order ${order.orderNumber}, placed on ${placed}, is cancelled.`
      : `We are sorry: your order ${order.orderNumber}, placed on ${placed}, has been cancelled. Reason: ${order.reason}`,
    order.lines.map(lineName).join('\n'),
    order.money.kind === 'refund'
      ? `We will refund ${rupees(order.money.amountPaise)} to the way you paid, and email you when the refund is made.`
      : 'Nothing was charged for this order.',
  ]
  return { text: lines.join('\n\n'), html: asHtml(lines) }
}
