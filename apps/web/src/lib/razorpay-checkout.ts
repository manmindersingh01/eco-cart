import type { PlacedOrder } from '@ecokart/core'
import { ApiError, apiRequest } from './api-client'

/*
 * Razorpay's hosted checkout in the buyer's browser (design doc 6.3 steps 5
 * and 6). Card and UPI details are typed into Razorpay's own window, never
 * into EcoKart. When Razorpay hands back the payment, the server checks its
 * signature and reads it back from Razorpay before the order is confirmed;
 * the webhook confirms the same payment too, whichever arrives first.
 */

export type OnlinePayment = NonNullable<PlacedOrder['payment']>

/** What /api/checkout/payment answers once it has checked the payment. */
export type PaymentResult = {
  orderId: string
  orderNumber: string
  status: 'confirmed' | 'pending' | 'cancelled'
}

export type PaymentOutcome =
  | { kind: 'checked'; result: PaymentResult }
  /** The buyer closed Razorpay's window without paying. */
  | { kind: 'closed' }
  /** Paid at Razorpay, but the check here failed; the webhook may still confirm it. */
  | { kind: 'unchecked'; message: string }
  /** Razorpay's window could not be opened. */
  | { kind: 'unavailable'; message: string }

type RazorpayResponse = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type RazorpayOptions = {
  key: string
  amount: number
  currency: string
  order_id: string
  name: string
  description: string
  prefill: { name: string; email?: string; contact: string }
  theme: { color: string }
  handler: (response: RazorpayResponse) => void
  modal: { ondismiss: () => void; confirm_close: boolean }
}

type RazorpayConstructor = new (options: RazorpayOptions) => { open(): void }

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'
let scriptLoading: Promise<RazorpayConstructor> | null = null

function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  scriptLoading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.addEventListener(
      'load',
      () => {
        if (window.Razorpay) resolve(window.Razorpay)
        else reject(new Error('Razorpay did not load'))
      },
      { once: true },
    )
    script.addEventListener(
      'error',
      () => reject(new Error('Razorpay could not be reached')),
      { once: true },
    )
    document.head.append(script)
  }).catch((error: unknown) => {
    // A later attempt, for example after the connection is back, tries again.
    scriptLoading = null
    throw error
  })
  return scriptLoading
}

/** The shop's brand colour for Razorpay's window, from the stylesheet. */
function brandColour(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--brand')
    .trim()
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#1f7a4d'
}

/**
 * Opens Razorpay's window for `payment` and waits until the buyer pays or
 * closes it. Resolves, never rejects, so the caller always learns where
 * the order stands.
 */
export async function payOnline(
  payment: OnlinePayment,
  orderNumber: string,
): Promise<PaymentOutcome> {
  let Razorpay: RazorpayConstructor
  try {
    Razorpay = await loadRazorpay()
  } catch {
    return {
      kind: 'unavailable',
      message:
        'The payment window could not be opened. Check your connection and try again.',
    }
  }
  return new Promise<PaymentOutcome>((resolve) => {
    const checkout = new Razorpay({
      key: payment.keyId,
      amount: payment.amountPaise,
      currency: payment.currency,
      order_id: payment.razorpayOrderId,
      name: 'EcoKart',
      description: `Order ${orderNumber}`,
      prefill: {
        name: payment.prefill.name,
        contact: payment.prefill.contact,
        ...(payment.prefill.email ? { email: payment.prefill.email } : {}),
      },
      theme: { color: brandColour() },
      // Razorpay retries a failed attempt inside its own window, so only a
      // successful payment or closing the window ends the wait.
      handler: (response) => {
        apiRequest<PaymentResult>('/api/checkout/payment', {
          method: 'POST',
          json: {
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          },
        })
          .then((result) => resolve({ kind: 'checked', result }))
          .catch((error: unknown) =>
            resolve({
              kind: 'unchecked',
              message:
                error instanceof ApiError
                  ? error.message
                  : 'We could not check your payment just now. If you paid, your order is confirmed as soon as Razorpay tells us.',
            }),
          )
      },
      modal: {
        ondismiss: () => resolve({ kind: 'closed' }),
        confirm_close: true,
      },
    })
    checkout.open()
  })
}
