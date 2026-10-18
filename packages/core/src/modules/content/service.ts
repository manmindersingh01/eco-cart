import { and, eq, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { contentPages } from '../../db/schema/index.ts'
import { ForbiddenError, NotFoundError } from '../../errors.ts'
import { parseInput } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { invalidateStorefront } from '../catalogue/storefront-cache.ts'
import {
  CONTENT_PAGES,
  CONTENT_SLUGS,
  CONTENT_STATUSES,
  contentPageInput,
  type ContentPageView,
  type ContentSlug,
  type ContentStatus,
  type PublicContentPage,
} from './types.ts'

/*
 * The storefront's policy pages (backend spec step 16, design doc 5.13):
 * terms, privacy, shipping, returns, refunds, and the seller agreement.
 * Administrators write each one in Markdown and publish it; visitors see
 * only published pages. The set of pages is fixed, so a page that nobody has
 * saved yet is shown to administrators as an empty draft.
 */

type ContentRow = typeof contentPages.$inferSelect
type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

const NO_PAGE = 'There is no page at that address'
const isContentSlug = (value: string): value is ContentSlug =>
  CONTENT_SLUGS.some((slug) => slug === value)

/** What the audit log keeps of a page. */
const audited = (
  from: Pick<ContentRow, 'title' | 'status' | 'bodyMarkdown'>,
) => ({
  title: from.title,
  status: from.status,
  bodyMarkdown: from.bodyMarkdown,
})

const isStatus = (value: string): value is ContentStatus =>
  CONTENT_STATUSES.some((status) => status === value)

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can edit content pages')
  }
}

function toView(
  slug: ContentSlug,
  row: ContentRow | undefined,
): ContentPageView {
  if (!row) {
    return {
      slug,
      title: CONTENT_PAGES[slug],
      bodyMarkdown: '',
      status: 'draft',
      saved: false,
      publishedAt: null,
      updatedAt: null,
      updatedBy: null,
    }
  }
  if (!isStatus(row.status)) {
    throw new Error(`Content page ${slug} has an unknown status ${row.status}`)
  }
  return {
    slug,
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    status: row.status,
    saved: true,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

function slugOrNotFound(slug: string): ContentSlug {
  if (!isContentSlug(slug)) throw new NotFoundError(NO_PAGE)
  return slug
}

/** Every page in the storefront's order. Administrators only. */
export async function listContentPages(
  tx: Transaction,
  context: RequestContext,
): Promise<ContentPageView[]> {
  assertAdministrator(context)
  const rows = await tx.select().from(contentPages)
  const saved = new Map(rows.map((row) => [row.slug, row]))
  return CONTENT_SLUGS.map((slug) => toView(slug, saved.get(slug)))
}

/** One page, saved or not. Administrators only. */
export async function getContentPage(
  tx: Transaction,
  context: RequestContext,
  slug: string,
): Promise<ContentPageView> {
  assertAdministrator(context)
  const page = slugOrNotFound(slug)
  const [row] = await tx
    .select()
    .from(contentPages)
    .where(eq(contentPages.slug, page))
  return toView(page, row)
}

/**
 * Saves a page's title, text, and status, with an audit entry holding the
 * text before and after, and refreshes the storefront's copy when the page
 * was or becomes published. `publishedAt` is when it last became published.
 * Administrators only (and the system, for the development seed).
 */
export async function saveContentPage(
  tx: Transaction,
  context: RequestContext,
  slug: string,
  input: unknown,
  ip?: string | null,
): Promise<ContentPageView> {
  assertAdministrator(context)
  const page = slugOrNotFound(slug)
  const values = parseInput(
    contentPageInput,
    input,
    'Those page details are not valid',
  )
  // Saves of one page take turns, also before its first save, when there is
  // no row to lock, so the audit entry's "before" is what this save replaced.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`content:${page}`}, 0))`,
  )
  const [previous] = await tx
    .select()
    .from(contentPages)
    .where(eq(contentPages.slug, page))
  const becomesPublished =
    values.status === 'published' && previous?.status !== 'published'
  const updatedBy = context.userId ?? null
  const publishedAt = becomesPublished
    ? sql`now()`
    : (previous?.publishedAt ?? null)

  const [row] = await tx
    .insert(contentPages)
    .values({ slug: page, ...values, updatedBy, publishedAt })
    .onConflictDoUpdate({
      target: contentPages.slug,
      set: { ...values, updatedBy, publishedAt },
    })
    .returning()

  if (previous?.status === 'published' || values.status === 'published') {
    await invalidateStorefront(tx, { contentSlug: page })
  }
  await recordAuditEntry(tx, {
    actorUserId: updatedBy,
    actorRole: context.role,
    action: 'content.save',
    entityType: 'content_page',
    entityId: page,
    before: previous ? audited(previous) : null,
    after: audited(values),
    ip,
  })
  return toView(page, row)
}

/** A published page, for anyone; 404 for a draft or an unknown address. */
export async function getPublishedContentPage(
  tx: Transaction,
  slug: string,
): Promise<PublicContentPage> {
  const page = slugOrNotFound(slug)
  const [row] = await tx
    .select()
    .from(contentPages)
    .where(
      and(eq(contentPages.slug, page), eq(contentPages.status, 'published')),
    )
  if (!row?.publishedAt) throw new NotFoundError(NO_PAGE)
  return {
    slug: page,
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  }
}
