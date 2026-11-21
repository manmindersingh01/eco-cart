import { listAddresses, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AccountNav } from '@/components/buyer/account-nav'
import { AddressBook } from '@/components/buyer/address-book'
import { ContentLoading } from '@/components/ui/page-loading'
import { requireBuyerPage } from '@/lib/buyer-page'
import { getDatabase } from '@/lib/db'

export const metadata: Metadata = { title: 'Your addresses' }
export const instant = false

export default function AddressesPage() {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your addresses
        </h1>
        <AccountNav current="/account/addresses" />
        <Suspense fallback={<ContentLoading />}>
          <Addresses />
        </Suspense>
      </div>
    </main>
  )
}

async function Addresses() {
  const { context } = await requireBuyerPage('/account/addresses')
  const addresses = await withContext(getDatabase(), context, (tx) =>
    listAddresses(tx, context),
  )
  return (
    <AddressBook
      initial={addresses.map(
        ({ createdAt: _created, updatedAt: _updated, ...address }) => address,
      )}
    />
  )
}
