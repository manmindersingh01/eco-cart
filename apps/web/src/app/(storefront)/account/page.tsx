import { isPlaceholderEmail } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AccountNav } from '@/components/buyer/account-nav'
import { ProfileForm } from '@/components/buyer/profile-form'
import { Card } from '@/components/ui/feedback'
import { ContentLoading } from '@/components/ui/page-loading'
import { requireBuyerPage } from '@/lib/buyer-page'

export const metadata: Metadata = {
  title: 'Your profile',
  robots: { index: false },
}
export const instant = false
export default function AccountPage() {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your profile
        </h1>
        <AccountNav current="/account" />
        <Suspense fallback={<ContentLoading />}>
          <Profile />
        </Suspense>
      </div>
    </main>
  )
}

async function Profile() {
  const { session } = await requireBuyerPage('/account')
  const { user } = session
  const email = isPlaceholderEmail(user.email) ? null : user.email
  return (
    <>
      <Card className="max-w-2xl">
        <h2 className="text-lg font-semibold">Sign-in details</h2>
        <dl className="mt-3 grid gap-3 text-sm">
          <div>
            <dt className="text-muted">Email address</dt>
            <dd className="break-all">{email ?? 'No email address added'}</dd>
          </div>
          <div>
            <dt className="text-muted">Mobile number</dt>
            <dd>{user.phoneNumber ?? 'No mobile number added'}</dd>
          </div>
        </dl>
      </Card>
      <ProfileForm key={user.id} initialName={user.name} />
    </>
  )
}
