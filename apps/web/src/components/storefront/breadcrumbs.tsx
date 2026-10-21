import Link from 'next/link'

/**
 * Home, then the category path from the top level down. The current
 * category is shown but not linked; a product page links every category.
 */
export function Breadcrumbs({
  trail,
  currentId,
}: {
  trail: readonly { id: string; name: string; slug: string }[]
  currentId?: string
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
        <li>
          <Link href="/" className="hover:text-brand-strong hover:underline">
            Home
          </Link>
        </li>
        {trail.map((step) => (
          <li key={step.id} className="flex items-center gap-2">
            <span aria-hidden="true">›</span>
            {step.id === currentId ? (
              <span aria-current="page" className="font-medium text-foreground">
                {step.name}
              </span>
            ) : (
              <Link
                href={`/categories/${step.slug}`}
                className="hover:text-brand-strong hover:underline"
              >
                {step.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
