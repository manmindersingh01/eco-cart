import { z } from 'zod'

export type EmailOtpPurpose =
  'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

/**
 * The outbox payload of an `otp` email. `code` is sealed with
 * MESSAGE_ENCRYPTION_KEY and set to null once the email is sent or given up.
 */
export const otpEmailPayload = z.object({
  code: z.string().nullable(),
  purpose: z.enum([
    'sign-in',
    'email-verification',
    'forget-password',
    'change-email',
  ]),
  expiresAt: z.iso.datetime(),
})
export type OtpEmailPayload = z.infer<typeof otpEmailPayload>

/** The data of a send-sms job; `code` is sealed. */
export const otpSmsJob = z.object({
  to: z.string(),
  code: z.string(),
  expiresAt: z.iso.datetime(),
})
export type OtpSmsJob = z.infer<typeof otpSmsJob>

export const sendEmailJob = z.object({ outboxId: z.number().int() })
export type SendEmailJob = z.infer<typeof sendEmailJob>

// Order emails (backend spec steps 12 and 13). The payload holds everything
// the email shows, frozen when it is queued, so sending never reads orders.

const shippingAddress = z.object({
  fullName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string(),
  stateCode: z.string(),
  pincode: z.string(),
})

const emailLine = z.object({
  title: z.string(),
  options: z.record(z.string(), z.string()),
  quantity: z.number().int(),
  lineTotalPaise: z.number().int(),
})

export const orderPlacedPayload = z.object({
  orderNumber: z.string(),
  buyerName: z.string(),
  placedAt: z.iso.datetime(),
  paymentMethod: z.enum(['razorpay', 'cod']),
  lines: z.array(emailLine).min(1),
  subtotalPaise: z.number().int(),
  discountPaise: z.number().int(),
  deliveryPaise: z.number().int(),
  totalPaise: z.number().int(),
  shippingAddress,
})
export type OrderPlacedPayload = z.infer<typeof orderPlacedPayload>

export const paymentReceivedPayload = z.object({
  orderNumber: z.string(),
  amountPaise: z.number().int(),
  /** As Razorpay reports it, for example upi or card. */
  method: z.string().nullable(),
  paidAt: z.iso.datetime(),
})
export type PaymentReceivedPayload = z.infer<typeof paymentReceivedPayload>
