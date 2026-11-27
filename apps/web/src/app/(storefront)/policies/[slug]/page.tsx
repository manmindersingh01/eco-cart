import { NotFoundError } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PolicyMarkdown } from '@/components/ui/policy-markdown'
import { ContentLoading } from '@/components/ui/page-loading'
import { readContentPage } from '@/lib/storefront'
import { formatIndianDate } from '@/lib/format'

export async function generateMetadata({
  params,
}: PageProps<'/policies/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  try {
    const page = await readContentPage(slug)
    return { title: page.title, alternates: { canonical: `/policies/${slug}` } }
  } catch (cause) {
    if (cause instanceof NotFoundError)
      return { title: 'Policy not found', robots: { index: false } }
    throw cause
  }
}

export default function PolicyPage(props: PageProps<'/policies/[slug]'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <Suspense fallback={<ContentLoading />}>
        <PolicyContent {...props} />
      </Suspense>
    </main>
  )
}
async function PolicyContent({ params }: PageProps<'/policies/[slug]'>) {
  const { slug } = await params
  let page
  try {
    page = await readContentPage(slug)
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  return (
    <article className="mx-auto grid max-w-3xl gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
      <p className="text-sm text-muted">
        Last updated: {formatIndianDate(page.updatedAt, { includeTime: true })}
      </p>
      <PolicyMarkdown>{page.bodyMarkdown}</PolicyMarkdown>
    </article>
  )
}
