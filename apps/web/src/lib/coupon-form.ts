import type { CouponView } from '@ecokart/core'
import {
  basisPointsToPercentInput,
  paiseToRupeeInput,
  parsePercentToBasisPoints,
  parseRupeesToPaise,
  parseWholeNumber,
} from './admin-settings'

export type CouponData = Omit<
  CouponView,
  'startsAt' | 'endsAt' | 'createdAt' | 'updatedAt'
> & {
  startsAt: string
  endsAt: string | null
  createdAt: string
  updatedAt: string
}
export function serialiseCoupon(coupon: CouponView): CouponData {
  return {
    ...coupon,
    startsAt: coupon.startsAt.toISOString(),
    endsAt: coupon.endsAt?.toISOString() ?? null,
    createdAt: coupon.createdAt.toISOString(),
    updatedAt: coupon.updatedAt.toISOString(),
  }
}
export type CouponValues = {
  code: string
  description: string
  discountType: 'percent' | 'fixed'
  discount: string
  minimum: string
  cap: string
  usage: string
  perBuyer: string
  start: string
  end: string
  active: boolean
}
export const emptyCoupon: CouponValues = {
  code: '',
  description: '',
  discountType: 'percent',
  discount: '',
  minimum: '0',
  cap: '',
  usage: '',
  perBuyer: '',
  start: '',
  end: '',
  active: true,
}

const india = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
export function indiaDateTime(value: string): string {
  const parts = Object.fromEntries(
    india.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
function dateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(`${value}:00+05:30`)
  if (
    Number.isNaN(date.getTime()) ||
    indiaDateTime(date.toISOString()) !== value
  )
    return null
  return date.toISOString()
}
export function couponValues(coupon: CouponData): CouponValues {
  return {
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discount:
      coupon.discountType === 'percent'
        ? basisPointsToPercentInput(coupon.discountValue)
        : paiseToRupeeInput(coupon.discountValue),
    minimum: paiseToRupeeInput(coupon.minOrderPaise),
    cap:
      coupon.maxDiscountPaise === null
        ? ''
        : paiseToRupeeInput(coupon.maxDiscountPaise),
    usage: coupon.usageLimit === null ? '' : String(coupon.usageLimit),
    perBuyer: coupon.perUserLimit === null ? '' : String(coupon.perUserLimit),
    start: indiaDateTime(coupon.startsAt),
    end: coupon.endsAt ? indiaDateTime(coupon.endsAt) : '',
    active: coupon.isActive,
  }
}
export function couponPayload(
  values: CouponValues,
  original?: CouponData,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const discount =
    values.discountType === 'percent'
      ? parsePercentToBasisPoints(values.discount)
      : parseRupeesToPaise(values.discount)
  const minimum = parseRupeesToPaise(values.minimum)
  const cap =
    values.discountType === 'percent' && values.cap.trim()
      ? parseRupeesToPaise(values.cap)
      : { ok: true as const, value: null }
  const usage = values.usage.trim()
    ? parseWholeNumber(values.usage, 'Total usage limit')
    : { ok: true as const, value: null }
  const perBuyer = values.perBuyer.trim()
    ? parseWholeNumber(values.perBuyer, 'Per-buyer limit')
    : { ok: true as const, value: null }
  for (const parsed of [discount, minimum, cap, usage, perBuyer])
    if (!parsed.ok) return parsed
  if (!discount.ok || !minimum.ok || !cap.ok || !usage.ok || !perBuyer.ok)
    return { ok: false, error: 'Check the coupon values.' }
  const mutable = {
    description: values.description.trim(),
    discountType: values.discountType,
    discountValue: discount.value,
    minOrderPaise: minimum.value,
    maxDiscountPaise: cap.value,
    usageLimit: usage.value,
    perUserLimit: perBuyer.value,
  }
  const fields = [
    'description',
    'discountType',
    'discountValue',
    'minOrderPaise',
    'maxDiscountPaise',
    'usageLimit',
    'perUserLimit',
  ] as const
  const value: Record<string, unknown> = original
    ? Object.fromEntries(
        fields
          .filter((key) => mutable[key] !== original[key])
          .map((key) => [key, mutable[key]]),
      )
    : {
        code: values.code.trim().toUpperCase(),
        ...mutable,
        isActive: values.active,
      }
  // Keep discount units and their cap together if another administrator changed the type.
  if (
    original &&
    (mutable.discountType !== original.discountType ||
      mutable.discountValue !== original.discountValue ||
      mutable.maxDiscountPaise !== original.maxDiscountPaise)
  ) {
    Object.assign(value, {
      discountType: mutable.discountType,
      discountValue: mutable.discountValue,
      maxDiscountPaise: mutable.maxDiscountPaise,
    })
  }
  // Unchanged minute fields must not round away the stored seconds or milliseconds.
  if (!original || values.start !== indiaDateTime(original.startsAt)) {
    if (values.start) {
      const start = dateInput(values.start)
      if (!start)
        return {
          ok: false,
          error: 'Enter a valid start date and time in India.',
        }
      value.startsAt = start
    } else if (original)
      return { ok: false, error: 'The start date cannot be cleared.' }
  }
  if (
    !original ||
    values.end !== (original.endsAt ? indiaDateTime(original.endsAt) : '')
  ) {
    if (values.end) {
      const end = dateInput(values.end)
      if (!end)
        return { ok: false, error: 'Enter a valid end date and time in India.' }
      value.endsAt = end
    } else value.endsAt = null
  }
  if (original && !Object.keys(value).length)
    return { ok: false, error: 'There are no changes to save.' }
  return { ok: true, value }
}

export function couponIssue(
  issue: string,
  discountType: 'percent' | 'fixed',
): string {
  if (
    discountType === 'percent' &&
    issue.startsWith('discountValue must be at most')
  )
    return 'Percentage must be at most 100%.'
  if (issue === 'discountValue must be at least 1')
    return discountType === 'percent'
      ? 'Percentage must be at least 0.01%.'
      : 'Discount must be at least ₹0.01.'
  if (issue === 'maxDiscountPaise must be at least 1')
    return 'Maximum discount must be at least ₹0.01.'
  if (issue.startsWith('minOrderPaise must be more'))
    return 'The minimum order must be more than the fixed discount, so no order is free.'
  const names: Record<string, string> = {
    code: 'Code',
    description: 'Description',
    discountType: 'Discount type',
    discountValue: 'Discount value',
    minOrderPaise: 'Minimum order',
    maxDiscountPaise: 'Maximum discount',
    usageLimit: 'Total usage limit',
    perUserLimit: 'Per-buyer limit',
    startsAt: 'Start date',
    endsAt: 'End date',
  }
  const labelled = issue.replace(/\b[A-Za-z]+\b/g, (field, offset: number) =>
    names[field]
      ? offset === 0
        ? names[field]
        : names[field].toLowerCase()
      : field,
  )
  return /^(discountValue|minOrderPaise|maxDiscountPaise)\b/.test(issue)
    ? labelled.replace(/\b100000000\b/g, '₹10,00,000')
    : labelled
}
