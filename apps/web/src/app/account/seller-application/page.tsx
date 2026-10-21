import { getOwnApplication, NotFoundError } from '@ecokart/core'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import {
  ApplicationManager,
  type Application,
} from '@/components/seller/application-manager'
import { getDatabase } from '@/lib/db'
import { getRequestContext } from '@/lib/request-context'

export const metadata = { title: 'Seller application' }
export const instant = false

export default function ApplicationPage() {
  return (
    <Suspense fallback={<output>Loading application...</output>}>
      <ApplicationData />
    </Suspense>
  )
}

async function ApplicationData() {
  const { session, context } = await getRequestContext(await headers())
  if (!session) redirect('/sign-in?returnTo=%2Faccount%2Fseller-application')
  if (context.role === 'admin') redirect('/access-denied?area=seller')
  if (context.role === 'seller') redirect('/seller/profile')
  let application: Application | null = null
  try {
    const current = await getOwnApplication(getDatabase(), context)
    application = {
      ...current,
      approvedAt: current.approvedAt?.toISOString() ?? null,
      createdAt: current.createdAt.toISOString(),
      updatedAt: current.updatedAt.toISOString(),
    }
  } catch (cause) {
    if (!(cause instanceof NotFoundError)) throw cause
  }
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
    >
      <ApplicationManager initialApplication={application} />
    </main>
  )
}
