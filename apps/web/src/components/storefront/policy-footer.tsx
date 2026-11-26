import { CONTENT_PAGES, CONTENT_SLUGS, NotConfiguredError } from '@ecokart/core'
import Link from 'next/link'
import { Suspense } from 'react'
import { readCompanyDetails } from '@/lib/storefront'

export function PolicyFooter() {
  return (
    <footer className="mt-auto border-t bg-surface">
      <div className="page-container grid gap-6 py-8 text-sm">
        <p className="text-muted">
          EcoKart connects buyers with independent sellers across India.
        </p>
        <nav aria-label="Policies">
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {CONTENT_SLUGS.map((slug) => (
              <li key={slug}>
                <Link
                  className="inline-flex min-h-11 items-center text-brand-strong underline underline-offset-4"
                  href={`/policies/${slug}`}
                >
                  {CONTENT_PAGES[slug]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Suspense
          fallback={<p className="text-muted">Loading company details…</p>}
        >
          <CompanyDetails />
        </Suspense>
      </div>
    </footer>
  )
}

export async function CompanyDetails() {
  let company
  try {
    company = await readCompanyDetails()
  } catch (cause) {
    if (cause instanceof NotConfiguredError)
      return (
        <p className="text-muted">
          Company details will be available here soon.
        </p>
      )
    throw cause
  }
  const { address, grievanceOfficer } = company
  return (
    <section
      aria-label="Company details"
      className="grid min-w-0 gap-4 break-words sm:grid-cols-2"
    >
      <div className="grid content-start gap-2">
        <h2 className="font-semibold">{company.legalName}</h2>
        <address className="not-italic">
          {[
            address.line1,
            address.line2,
            address.city,
            address.stateName,
            address.pincode,
          ]
            .filter(Boolean)
            .join(', ')}
        </address>
        <p>GSTIN: {company.gstin}</p>
        <a
          className="text-brand-strong underline"
          href={`mailto:${company.supportEmail}`}
        >
          {company.supportEmail}
        </a>
        <a
          className="text-brand-strong underline"
          href={`tel:${company.supportPhone}`}
        >
          {company.supportPhone}
        </a>
      </div>
      <div className="grid content-start gap-2">
        <h2 className="font-semibold">Grievance officer</h2>
        <p>{grievanceOfficer.name}</p>
        <a
          className="text-brand-strong underline"
          href={`mailto:${grievanceOfficer.email}`}
        >
          {grievanceOfficer.email}
        </a>
        <a
          className="text-brand-strong underline"
          href={`tel:${grievanceOfficer.phone}`}
        >
          {grievanceOfficer.phone}
        </a>
      </div>
    </section>
  )
}
