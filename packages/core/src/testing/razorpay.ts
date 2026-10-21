import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { text } from 'node:stream/consumers'
import { z } from 'zod'
import type { RazorpayConfig } from '../lib/razorpay.ts'

/*
 * A stand-in for Razorpay's API on a local port, for tests and local runs
 * while there are no Razorpay keys (backend spec step 12). It answers the
 * two calls EcoKart makes, creating an order and reading a payment, and
 * plays the buyer's side: paying an order, then producing the checkout
 * signature and the webhook delivery Razorpay would send.
 */

interface FakeOrder {
  id: string
  amount: number
  currency: 'INR'
  receipt: string
  notes: Record<string, string>
}

interface FakePayment {
  id: string
  order_id: string
  amount: number
  currency: 'INR'
  status: 'captured' | 'failed'
  method: string
  error_description: string | null
}

export interface FakeRazorpay {
  config: RazorpayConfig
  orders: Map<string, FakeOrder>
  /** Makes the next order request fail with this HTTP status. */
  failNextOrder(status: number): void
  /** The buyer pays an order on the checkout; returns the payment. */
  pay(
    orderId: string,
    options?: {
      method?: string
      status?: 'captured' | 'failed'
      amount?: number
    },
  ): FakePayment
  /** What Razorpay's checkout hands the browser after a payment. */
  checkoutReturn(payment: FakePayment): {
    razorpayOrderId: string
    razorpayPaymentId: string
    razorpaySignature: string
  }
  /** A signed webhook delivery for `payment`, as Razorpay sends it. */
  webhook(
    event: 'payment.captured' | 'order.paid' | 'payment.failed',
    payment: FakePayment,
  ): { rawBody: string; signature: string; eventId: string }
  close(): Promise<void>
}

const id = (prefix: string) =>
  `${prefix}_${randomBytes(7).toString('base64url').replaceAll(/[-_]/g, 'x')}`

const sign = (secret: string, message: string) =>
  createHmac('sha256', secret).update(message).digest('hex')

const orderRequest = z.object({
  amount: z.number(),
  receipt: z.string(),
  notes: z.record(z.string(), z.string()),
})

/**
 * Starts the stand-in with new keys on a free port, or, for a local run
 * (`pnpm demo:flow`), with the keys and the port a running web app was given.
 */
export async function startFakeRazorpay(
  fixed: {
    keyId: string
    keySecret: string
    webhookSecret: string
    port: number
  } | null = null,
): Promise<FakeRazorpay> {
  const keyId = fixed?.keyId ?? `rzp_test_${randomBytes(6).toString('hex')}`
  const keySecret =
    fixed?.keySecret ?? `test-key-secret-${randomBytes(8).toString('hex')}`
  const webhookSecret =
    fixed?.webhookSecret ??
    `test-webhook-secret-${randomBytes(8).toString('hex')}`
  const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`
  const orders = new Map<string, FakeOrder>()
  const payments = new Map<string, FakePayment>()
  let nextOrderFailure: number | null = null

  const server = createServer(async (request, response) => {
    const answer = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    const error = (status: number, description: string) =>
      answer(status, { error: { code: 'BAD_REQUEST_ERROR', description } })

    if (request.headers.authorization !== authorization) {
      return error(401, 'Authentication failed')
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'POST' && url.pathname === '/orders') {
      if (nextOrderFailure !== null) {
        const status = nextOrderFailure
        nextOrderFailure = null
        return error(status, 'The fake Razorpay was told to fail')
      }
      const body = orderRequest.parse(JSON.parse(await text(request)))
      if (!Number.isInteger(body.amount) || body.amount < 100) {
        return error(400, 'The amount must be at least INR 1.00')
      }
      const order: FakeOrder = { ...body, id: id('order'), currency: 'INR' }
      orders.set(order.id, order)
      return answer(200, { ...order, entity: 'order', status: 'created' })
    }
    const payment = /^\/payments\/([\w]+)$/.exec(url.pathname)
    if (request.method === 'GET' && payment) {
      const found = payments.get(payment[1]!)
      return found
        ? answer(200, { ...found, entity: 'payment' })
        : error(400, 'The id provided does not exist')
    }
    return error(404, 'The requested URL was not found on the server')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(fixed?.port ?? 0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('The fake Razorpay is not listening on a port')
  }
  const { port } = address

  return {
    config: {
      keyId,
      keySecret,
      webhookSecret,
      apiUrl: `http://127.0.0.1:${port}`,
    },
    orders,
    failNextOrder(status) {
      nextOrderFailure = status
    },
    pay(orderId, options = {}) {
      const order = orders.get(orderId)
      if (!order) throw new Error(`The fake Razorpay has no order ${orderId}`)
      const status = options.status ?? 'captured'
      const made: FakePayment = {
        id: id('pay'),
        order_id: orderId,
        amount: options.amount ?? order.amount,
        currency: 'INR',
        status,
        method: options.method ?? 'upi',
        error_description:
          status === 'failed' ? 'Your bank declined the payment' : null,
      }
      payments.set(made.id, made)
      return made
    },
    checkoutReturn(made) {
      return {
        razorpayOrderId: made.order_id,
        razorpayPaymentId: made.id,
        razorpaySignature: sign(keySecret, `${made.order_id}|${made.id}`),
      }
    },
    webhook(event, made) {
      const rawBody = JSON.stringify({
        entity: 'event',
        event,
        payload: { payment: { entity: { ...made, entity: 'payment' } } },
        created_at: Math.floor(Date.now() / 1000),
      })
      return {
        rawBody,
        signature: sign(webhookSecret, rawBody),
        eventId: id('evt'),
      }
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((closed) => (closed ? reject(closed) : resolve())),
      ),
  }
}
