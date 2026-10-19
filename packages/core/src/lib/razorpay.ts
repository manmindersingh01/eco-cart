import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { parseEnv, secretString } from './config.ts'

/*
 * Razorpay, the payment gateway (design doc 6.3), through plain fetch: create
 * an order for the amount, verify the checkout and webhook signatures, and
 * read a payment back. EcoKart never sees card details; the buyer pays on
 * Razorpay's own checkout.
 */

export const RAZORPAY_API_URL = 'https://api.razorpay.com/v1'

export interface RazorpayConfig {
  keyId: string
  keySecret: string
  /** Set in the Razorpay dashboard for the webhook; signs each delivery. */
  webhookSecret: string
  /** Razorpay's API, or a stand-in server in tests. */
  apiUrl: string
}

const blankAsMissing = (value: unknown) => (value === '' ? undefined : value)
const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess(blankAsMissing, schema.optional())

const isProduction = (env: NodeJS.ProcessEnv) => env.NODE_ENV === 'production'

/**
 * The Razorpay settings, or null when none of the keys is set, which switches
 * online payment off and leaves cash on delivery. Setting only some of them
 * stops the program, so a deploy with a missing key never loses online
 * payment without anyone noticing.
 */
export function loadRazorpayConfig(
  env: NodeJS.ProcessEnv = process.env,
): RazorpayConfig | null {
  const values = parseEnv(
    z
      .object({
        RAZORPAY_KEY_ID: optional(
          z
            .string()
            .regex(
              /^rzp_(test|live)_\w+$/,
              'must be a key id like rzp_live_...',
            ),
        ),
        RAZORPAY_KEY_SECRET: optional(secretString(env, 16)),
        RAZORPAY_WEBHOOK_SECRET: optional(secretString(env, 16)),
        RAZORPAY_API_URL: optional(
          z
            .url({
              error: 'must be an address like https://api.razorpay.com/v1',
            })
            .refine(
              (value) => !isProduction(env) || value === RAZORPAY_API_URL,
              `must be ${RAZORPAY_API_URL} in production`,
            ),
        ),
      })
      .refine(
        (config) =>
          [
            config.RAZORPAY_KEY_ID,
            config.RAZORPAY_KEY_SECRET,
            config.RAZORPAY_WEBHOOK_SECRET,
          ].every((value) => value === undefined) ||
          [
            config.RAZORPAY_KEY_ID,
            config.RAZORPAY_KEY_SECRET,
            config.RAZORPAY_WEBHOOK_SECRET,
          ].every((value) => value !== undefined),
        {
          path: ['RAZORPAY_KEY_ID'],
          message:
            'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET must be set together, or none of them',
        },
      ),
    env,
  )
  if (
    !values.RAZORPAY_KEY_ID ||
    !values.RAZORPAY_KEY_SECRET ||
    !values.RAZORPAY_WEBHOOK_SECRET
  ) {
    return null
  }
  return {
    keyId: values.RAZORPAY_KEY_ID,
    keySecret: values.RAZORPAY_KEY_SECRET,
    webhookSecret: values.RAZORPAY_WEBHOOK_SECRET,
    apiUrl: values.RAZORPAY_API_URL ?? RAZORPAY_API_URL,
  }
}

/** A Razorpay order: what the buyer pays for on Razorpay's checkout. */
export interface RazorpayOrder {
  id: string
  amountPaise: number
  currency: string
}

/** A payment as Razorpay reports it. */
export interface RazorpayPayment {
  id: string
  orderId: string | null
  amountPaise: number
  currency: string
  /** created, authorized, captured, refunded, or failed. */
  status: string
  /** For example upi, card, netbanking, or wallet. */
  method: string | null
  errorDescription: string | null
}

/** Razorpay answered with an error, or could not be reached. */
export class RazorpayError extends Error {
  override name = 'RazorpayError'
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

export interface Razorpay {
  readonly keyId: string
  createOrder(order: {
    amountPaise: number
    /** Our order number, shown in Razorpay's dashboard. */
    receipt: string
    notes: Record<string, string>
  }): Promise<RazorpayOrder>
  fetchPayment(paymentId: string): Promise<RazorpayPayment>
  /** The signature Razorpay's checkout hands the browser after payment. */
  checkoutSignatureIsValid(payment: {
    orderId: string
    paymentId: string
    signature: string
  }): boolean
  /** The X-Razorpay-Signature of a webhook delivery, over its raw body. */
  webhookSignatureIsValid(rawBody: string, signature: string): boolean
}

const hmacHex = (secret: string, message: string) =>
  createHmac('sha256', secret).update(message).digest('hex')

/** Compares in constant time, so the answer time reveals nothing. */
function sameHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

const orderShape = z.object({
  id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
})

const paymentShape = z.object({
  id: z.string(),
  order_id: z.string().nullable(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  method: z.string().nullable().optional(),
  error_description: z.string().nullable().optional(),
})

/** Turns Razorpay's answer to a payment into ours. */
export function toRazorpayPayment(entity: unknown): RazorpayPayment {
  const payment = readRazorpayPayment(entity)
  if (!payment)
    throw new RazorpayError('Razorpay answered with an unreadable payment')
  return payment
}

/** The payment in a webhook event, or null when it cannot be read. */
export function readRazorpayPayment(entity: unknown): RazorpayPayment | null {
  const parsed = paymentShape.safeParse(entity)
  if (!parsed.success) return null
  const payment = parsed.data
  return {
    id: payment.id,
    orderId: payment.order_id,
    amountPaise: payment.amount,
    currency: payment.currency,
    status: payment.status,
    method: payment.method ?? null,
    errorDescription: payment.error_description ?? null,
  }
}

/** Each call gives up after this long, so a slow gateway never hangs a request. */
const TIMEOUT_MS = 10_000

export function createRazorpay(
  config: RazorpayConfig,
  fetchImpl: typeof fetch = fetch,
): Razorpay {
  const authorization = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`

  async function call(
    path: string,
    init: { method?: 'POST'; body?: string } = {},
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetchImpl(`${config.apiUrl}${path}`, {
        ...init,
        headers: { authorization, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new RazorpayError(
        `Razorpay could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const description = z
        .object({ error: z.object({ description: z.string() }) })
        .safeParse(body)
      throw new RazorpayError(
        description.success
          ? description.data.error.description
          : `Razorpay answered ${response.status}`,
        response.status,
      )
    }
    return body
  }

  return {
    keyId: config.keyId,
    async createOrder(order) {
      const created = orderShape.parse(
        await call('/orders', {
          method: 'POST',
          body: JSON.stringify({
            amount: order.amountPaise,
            currency: 'INR',
            receipt: order.receipt,
            notes: order.notes,
          }),
        }),
      )
      return {
        id: created.id,
        amountPaise: created.amount,
        currency: created.currency,
      }
    },
    async fetchPayment(paymentId) {
      return toRazorpayPayment(
        await call(`/payments/${encodeURIComponent(paymentId)}`),
      )
    },
    checkoutSignatureIsValid({ orderId, paymentId, signature }) {
      return sameHex(
        hmacHex(config.keySecret, `${orderId}|${paymentId}`),
        signature,
      )
    },
    webhookSignatureIsValid(rawBody, signature) {
      return sameHex(hmacHex(config.webhookSecret, rawBody), signature)
    },
  }
}
