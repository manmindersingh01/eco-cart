import type { Metadata } from 'next'
import { CartManager } from '@/components/buyer/cart-manager'

export const metadata: Metadata = {
  title: 'Your cart',
  robots: { index: false },
}

export default function CartPage() {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your cart
        </h1>
        {/* Personal, so it is read in the browser and never cached. */}
        <CartManager />
      </div>
    </main>
  )
}
