import { checkoutOptions, listAddresses, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CheckoutManager } from '@/components/buyer/checkout-manager'
import { PageLoading } from '@/components/ui/page-loading'
import { requireBuyerPage } from '@/lib/buyer-page'
import { getDatabase } from '@/lib/db'
import { getRazorpay } from '@/lib/razorpay'

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
}
export const instant = false

export default function CheckoutPage() {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Checkout
        </h1>
        <Suspense fallback={<PageLoading />}>
          <Checkout />
        </Suspense>
      </div>
    </main>
  )
}

async function Checkout() {
  // A guest signs in here and comes back; their cart moves into the
  // account on the first cart read after that.
  const { context } = await requireBuyerPage('/checkout')
  const [addresses, options] = await withContext(
    getDatabase(),
    context,
    async (tx) =>
      [
        await listAddresses(tx, context),
        await checkoutOptions(tx, getRazorpay()),
      ] as const,
  )
  return (
    <CheckoutManager
      initialAddresses={addresses.map(
        ({ createdAt: _created, updatedAt: _updated, ...address }) => address,
      )}
      options={options}
    />
  )
}
