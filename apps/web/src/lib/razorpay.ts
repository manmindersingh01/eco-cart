import {
  createRazorpay,
  loadRazorpayConfig,
  type Razorpay,
} from '@ecokart/core'

const globalForRazorpay = globalThis as typeof globalThis & {
  ecokartRazorpay?: Razorpay | null
}

/**
 * The Razorpay client, or null while its keys are not set, which switches
 * online payment off and leaves cash on delivery (backend spec step 12).
 */
export function getRazorpay(): Razorpay | null {
  if (globalForRazorpay.ecokartRazorpay === undefined) {
    const config = loadRazorpayConfig()
    globalForRazorpay.ecokartRazorpay = config ? createRazorpay(config) : null
  }
  return globalForRazorpay.ecokartRazorpay
}
