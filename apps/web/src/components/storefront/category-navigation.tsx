import Link from 'next/link'
import { connection } from 'next/server'
import { getPublicCategories } from '@/lib/public-catalogue'

export async function CategoryNavigation() {
  await connection()
  const categories = await getPublicCategories()

  return (
    <nav aria-label="Public catalogue" className="border-t">
      <div className="page-container relative flex min-h-12 items-center gap-3 py-2 text-sm">
        {categories.length ? (
          <details className="group relative shrink-0">
            <summary className="cursor-pointer rounded-md px-2 py-1 font-medium text-muted hover:text-brand-strong">
              Browse categories
            </summary>
            <div className="absolute left-0 z-30 mt-2 max-h-[70vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-surface p-5 shadow-xl">
              <CategoryMenu categories={categories} />
            </div>
          </details>
        ) : (
          <span className="shrink-0 text-muted">
            Categories are being prepared
          </span>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto py-1">
          <Link
            href="/#new-arrivals"
            className="shrink-0 rounded-md font-semibold text-brand-strong"
          >
            New arrivals
          </Link>
          <Link
            href="/#brands"
            className="shrink-0 rounded-md font-medium text-muted hover:text-brand-strong"
          >
            Discover brands
          </Link>
        </div>
      </div>
    </nav>
  )
}

function CategoryMenu({
  categories,
}: {
  categories: Awaited<ReturnType<typeof getPublicCategories>>
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {categories.map((category) => (
        <li key={category.id}>
          <Link
            href={`/categories/${category.slug}`}
            className="font-semibold hover:text-brand-strong hover:underline"
          >
            {category.name}
          </Link>
          {category.children.length ? (
            <ul className="mt-2 grid gap-2 border-l pl-3 text-muted">
              {category.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`/categories/${child.slug}`}
                    className="font-medium text-foreground hover:text-brand-strong hover:underline"
                  >
                    {child.name}
                  </Link>
                  {child.children.length ? (
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {child.children.map((leaf) => (
                        <li key={leaf.id}>
                          <Link
                            href={`/categories/${leaf.slug}`}
                            className="hover:text-brand-strong hover:underline"
                          >
                            {leaf.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
