import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startFakeRazorpay, type FakeRazorpay } from '../testing/razorpay.ts'
import {
  createRazorpay,
  loadRazorpayConfig,
  RAZORPAY_API_URL,
  RazorpayError,
  type Razorpay,
} from './razorpay.ts'

const keys = {
  RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456',
  RAZORPAY_KEY_SECRET: 's'.repeat(24),
  RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24),
}

describe('loadRazorpayConfig', () => {
  test('switches online payment off when no key is set', () => {
    expect(loadRazorpayConfig({})).toBeNull()
    expect(
      loadRazorpayConfig({
        RAZORPAY_KEY_ID: '',
        RAZORPAY_KEY_SECRET: '',
        RAZORPAY_WEBHOOK_SECRET: '',
      }),
    ).toBeNull()
  })

  test('uses Razorpay’s own address unless told otherwise', () => {
    expect(loadRazorpayConfig({ NODE_ENV: 'production', ...keys })).toEqual({
      keyId: keys.RAZORPAY_KEY_ID,
      keySecret: keys.RAZORPAY_KEY_SECRET,
      webhookSecret: keys.RAZORPAY_WEBHOOK_SECRET,
      apiUrl: RAZORPAY_API_URL,
    })
    expect(
      loadRazorpayConfig({ ...keys, RAZORPAY_API_URL: 'http://127.0.0.1:9' })
        ?.apiUrl,
    ).toBe('http://127.0.0.1:9')
  })

  test('stops when only some keys are set, or a stand-in is used in production', () => {
    const { RAZORPAY_WEBHOOK_SECRET: _secret, ...withoutWebhook } = keys
    expect(() => loadRazorpayConfig(withoutWebhook)).toThrow(
      'must be set together, or none of them',
    )
    expect(() =>
      loadRazorpayConfig({ ...keys, RAZORPAY_KEY_ID: 'key_123' }),
    ).toThrow('RAZORPAY_KEY_ID must be a key id like rzp_live_...')
    expect(() =>
      loadRazorpayConfig({
        NODE_ENV: 'production',
        ...keys,
        RAZORPAY_API_URL: 'http://127.0.0.1:9',
      }),
    ).toThrow(`RAZORPAY_API_URL must be ${RAZORPAY_API_URL} in production`)
    expect(() =>
      loadRazorpayConfig({
        NODE_ENV: 'production',
        ...keys,
        RAZORPAY_KEY_SECRET: 'development-only-razorpay-secret',
      }),
    ).toThrow('RAZORPAY_KEY_SECRET is the development example value')
  })
})

describe('the Razorpay client', () => {
  let fake: FakeRazorpay
  let razorpay: Razorpay

  beforeAll(async () => {
    fake = await startFakeRazorpay()
    razorpay = createRazorpay(fake.config)
  })
  afterAll(() => fake.close())

  test('creates an order and reads its payment back', async () => {
    const order = await razorpay.createOrder({
      amountPaise: 129_900,
      receipt: 'EK-261018-000001',
      notes: { orderNumber: 'EK-261018-000001' },
    })
    expect(order).toEqual({
      id: expect.stringMatching(/^order_/),
      amountPaise: 129_900,
      currency: 'INR',
    })
    const paid = fake.pay(order.id, { method: 'netbanking' })
    expect(await razorpay.fetchPayment(paid.id)).toEqual({
      id: paid.id,
      orderId: order.id,
      amountPaise: 129_900,
      currency: 'INR',
      status: 'captured',
      method: 'netbanking',
      errorDescription: null,
    })
  })

  test('accepts only signatures made with its own secrets', async () => {
    const order = await razorpay.createOrder({
      amountPaise: 10_000,
      receipt: 'EK-261018-000002',
      notes: {},
    })
    const paid = fake.pay(order.id)
    const returned = fake.checkoutReturn(paid)
    const genuine = {
      orderId: returned.razorpayOrderId,
      paymentId: returned.razorpayPaymentId,
      signature: returned.razorpaySignature,
    }
    expect(razorpay.checkoutSignatureIsValid(genuine)).toBe(true)
    expect(
      razorpay.checkoutSignatureIsValid({ ...genuine, paymentId: 'pay_other' }),
    ).toBe(false)
    expect(
      razorpay.checkoutSignatureIsValid({ ...genuine, signature: 'short' }),
    ).toBe(false)

    const delivery = fake.webhook('payment.captured', paid)
    expect(
      razorpay.webhookSignatureIsValid(delivery.rawBody, delivery.signature),
    ).toBe(true)
    expect(
      razorpay.webhookSignatureIsValid(
        `${delivery.rawBody} `,
        delivery.signature,
      ),
    ).toBe(false)
    // The checkout signature is made with the key secret, not the webhook one.
    expect(
      razorpay.webhookSignatureIsValid(
        `${genuine.orderId}|${genuine.paymentId}`,
        genuine.signature,
      ),
    ).toBe(false)
  })

  test('reports Razorpay’s own error, and a gateway it cannot reach', async () => {
    fake.failNextOrder(400)
    const refused = razorpay.createOrder({
      amountPaise: 10_000,
      receipt: 'EK-261018-000003',
      notes: {},
    })
    await expect(refused).rejects.toThrow(
      new RazorpayError('The fake Razorpay was told to fail', 400),
    )
    await expect(
      createRazorpay({ ...fake.config, keySecret: 'wrong' }).fetchPayment(
        'pay_x',
      ),
    ).rejects.toThrow('Authentication failed')
    await expect(
      createRazorpay({
        ...fake.config,
        apiUrl: 'http://127.0.0.1:9',
      }).fetchPayment('pay_x'),
    ).rejects.toThrow(/^Razorpay could not be reached/)
  })
})
