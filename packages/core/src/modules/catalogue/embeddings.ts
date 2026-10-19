import { createHash } from 'node:crypto'
import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import {
  brands,
  categories,
  productEmbeddings,
  productImages,
  products,
  productVariants,
} from '../../db/schema/index.ts'
import { AiProviderError, AiReplyError } from '../../lib/ai/client.ts'
import { EMBEDDING_DIMENSIONS, type EmbedInput } from '../../lib/ai/embed.ts'
import type { AiModels } from '../../lib/ai/index.ts'
import { imageSizeKey } from '../../lib/images.ts'
import type { JobQueue, QueueDefinition } from '../../lib/queue.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { callAi } from '../ai/service.ts'
import { photosToSend } from './ai-photos.ts'

/*
 * Product embeddings (backend spec step 18, design doc 5.5 and 6.8): one
 * `text` row per product and one `image` row per ready photo, all from the
 * same multimodal model, so text and photos share one index. Approval queues
 * the job; it embeds only what changed since the last time, by content
 * hash, so a product approved again with the same text and photos costs
 * nothing.
 *
 * Products approved while AI was off, or embedded with another model, are
 * found by a job that runs every 15 minutes, which is also the re-embed job
 * after a change of embedding model.
 */

export const EMBED_PRODUCT_QUEUE = 'catalogue.embed-product'
export const EMBED_MISSING_QUEUE = 'catalogue.embed-missing'

export const embeddingQueues: QueueDefinition[] = [
  {
    name: EMBED_PRODUCT_QUEUE,
    options: {
      retryLimit: 5,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
  {
    name: EMBED_MISSING_QUEUE,
    options: {
      retryLimit: 0,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const embedProductJob = z.object({ productId: z.uuid() })

/** Products queued by one run of the catch-up job. */
export const EMBED_MISSING_BATCH = 200

/** The longest description the search text keeps; the start says the most. */
const MAX_DESCRIPTION = 4000

export interface ProductDocument {
  title: string
  brandName: string | null
  categoryName: string
  highlights: string[]
  attributes: Record<string, string>
  optionValues: string[]
  description: string
}

/** The text a product is found by: what a buyer would describe it with. */
export function productDocumentText(document: ProductDocument): string {
  const attributes = Object.entries(document.attributes)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ')
  return [
    document.title,
    document.brandName ? `Brand: ${document.brandName}` : null,
    `Category: ${document.categoryName}`,
    document.highlights.length > 0 ? document.highlights.join('; ') : null,
    attributes === '' ? null : attributes,
    document.optionValues.length > 0
      ? `Options: ${[...new Set(document.optionValues)].join(', ')}`
      : null,
    document.description.trim() === ''
      ? null
      : document.description.trim().slice(0, MAX_DESCRIPTION),
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/** What an embedding was made from, so it is made again only when that changes. */
export const embeddingHash = (model: string, content: string): string =>
  createHash('sha256').update(`${model}\n${content}`).digest('hex')

interface EmbeddingSource {
  text: string
  photos: { id: string; storageKey: string; contentHash: string; url: string }[]
}

/** The product's search text and ready photos, or null when it is not on sale. */
async function readEmbeddingSource(
  tx: Transaction,
  storage: Pick<ObjectStorage, 'publicUrl'>,
  productId: string,
): Promise<EmbeddingSource | null> {
  const [product] = await tx
    .select({
      title: products.title,
      description: products.description,
      highlights: products.highlights,
      attributes: products.attributes,
      brandName: brands.name,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(
      and(
        eq(products.id, productId),
        eq(products.status, 'approved'),
        isNull(products.deletedAt),
      ),
    )
  if (!product) return null
  const variants = await tx
    .select({ options: productVariants.options })
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.createdAt))
  const photos = await tx
    .select({
      id: productImages.id,
      storageKey: productImages.storageKey,
      contentHash: productImages.contentHash,
    })
    .from(productImages)
    .where(
      and(
        eq(productImages.productId, productId),
        eq(productImages.status, 'ready'),
      ),
    )
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
  return {
    text: productDocumentText({
      ...product,
      optionValues: variants.flatMap((variant) =>
        Object.values(variant.options),
      ),
    }),
    photos: photos.flatMap((photo) =>
      // A ready photo always has its hash (a CHECK constraint says so).
      photo.contentHash === null
        ? []
        : [
            {
              id: photo.id,
              storageKey: photo.storageKey,
              contentHash: photo.contentHash,
              url: storage.publicUrl(imageSizeKey(photo.storageKey, 'card')),
            },
          ],
    ),
  }
}

/** One embedding the product should have, and what it is made from. */
interface Wanted {
  kind: 'text' | 'image'
  imageId: string | null
  contentHash: string
}

function wantedEmbeddings(source: EmbeddingSource, model: string): Wanted[] {
  return [
    {
      kind: 'text',
      imageId: null,
      contentHash: embeddingHash(model, source.text),
    },
    ...source.photos.map((photo): Wanted => ({
      kind: 'image',
      imageId: photo.id,
      contentHash: embeddingHash(model, photo.contentHash),
    })),
  ]
}

const sameRow = (a: Wanted, b: Wanted) =>
  a.kind === b.kind && a.imageId === b.imageId

/** Approval queues this in its own transaction (design doc 6.2 step 5). */
export async function queueProductEmbeddings(
  tx: Transaction,
  queue: Pick<JobQueue, 'send'>,
  productId: string,
): Promise<void> {
  await queue.send(tx, EMBED_PRODUCT_QUEUE, { productId })
}

const SYSTEM = { role: 'system' } as const

/**
 * Embeds what changed in one product's text and photos, and removes the
 * rows of photos that are no longer ready. Does nothing when AI is off or
 * the product is not on sale. A provider failure is thrown before the job's
 * `lastAttempt`, so the queue tries again; after that the catch-up job
 * queues the product again later.
 */
export async function embedProduct(
  deps: {
    /** Connected as ecokart_worker. */
    db: Database
    ai: AiModels | null
    storage: ObjectStorage
  },
  productId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const { ai } = deps
  if (ai === null) return
  const model = ai.embed.model
  const read = await deps.db.transaction(async (tx) => {
    const source = await readEmbeddingSource(tx, deps.storage, productId)
    if (!source) return null
    const existing = await tx
      .select({
        kind: productEmbeddings.kind,
        imageId: productEmbeddings.imageId,
        contentHash: productEmbeddings.contentHash,
      })
      .from(productEmbeddings)
      .where(eq(productEmbeddings.productId, productId))
    return { source, existing }
  })
  if (!read) return
  const { source } = read
  const missing = wantedEmbeddings(source, model).filter(
    (wanted) =>
      !read.existing.some(
        (row) =>
          row.kind === wanted.kind &&
          row.imageId === wanted.imageId &&
          row.contentHash === wanted.contentHash,
      ),
  )

  // Photos go to the model as their card size, inline when it cannot reach
  // them; one that cannot be read waits for the next try.
  const sent = await photosToSend(
    deps.storage,
    source.photos.filter((photo) =>
      missing.some((wanted) => wanted.imageId === photo.id),
    ),
    ai.embed.provider,
  )
  const inputs = missing.flatMap(
    (wanted): { wanted: Wanted; input: EmbedInput }[] => {
      if (wanted.kind === 'text') {
        return [{ wanted, input: { text: source.text } }]
      }
      const photo = source.photos.find((each) => each.id === wanted.imageId)
      const address = sent.find((each) => each.url === photo?.url)?.address
      return address ? [{ wanted, input: { imageUrl: address } }] : []
    },
  )

  let vectors: number[][] = []
  if (inputs.length > 0) {
    try {
      const answer = await callAi(deps.db, SYSTEM, ai, {
        feature: 'embedding',
        uses: 'embed',
        input: {
          productId,
          contentHashes: inputs.map(({ wanted }) => wanted.contentHash),
        },
        // The vectors are kept in product_embeddings, not in the log.
        storeResult: false,
        schema: z
          .array(z.array(z.number()).length(EMBEDDING_DIMENSIONS))
          .length(inputs.length),
        run: (embedder) =>
          embedder.embed(
            inputs.map(({ input }) => input),
            { inputType: 'search_document' },
          ),
      })
      vectors = answer.value
    } catch (error) {
      if (error instanceof AiReplyError) {
        console.error(`Could not embed product ${productId}`, error)
        return
      }
      if (error instanceof AiProviderError && lastAttempt) {
        console.error(`Giving up on embedding product ${productId}`, error)
        return
      }
      throw error
    }
  }

  await deps.db.transaction(async (tx) => {
    // The product may have changed while the model answered: only what
    // still matches it is stored, and a later job embeds the rest.
    const now = await readEmbeddingSource(tx, deps.storage, productId)
    if (!now) return
    const current = wantedEmbeddings(now, model)
    for (const [index, { wanted }] of inputs.entries()) {
      if (
        !current.some(
          (row) =>
            sameRow(row, wanted) && row.contentHash === wanted.contentHash,
        )
      ) {
        continue
      }
      await tx
        .insert(productEmbeddings)
        .values({
          productId,
          kind: wanted.kind,
          imageId: wanted.imageId,
          model,
          contentHash: wanted.contentHash,
          embedding: vectors[index]!,
        })
        .onConflictDoUpdate({
          target: [
            productEmbeddings.productId,
            productEmbeddings.kind,
            productEmbeddings.imageId,
          ],
          set: {
            model,
            contentHash: wanted.contentHash,
            embedding: vectors[index]!,
          },
        })
    }
    // Rows of photos that are no longer ready. A deleted photo's row goes
    // with it (ON DELETE CASCADE).
    const readyIds = now.photos.map((photo) => photo.id)
    await tx
      .delete(productEmbeddings)
      .where(
        and(
          eq(productEmbeddings.productId, productId),
          eq(productEmbeddings.kind, 'image'),
          ...(readyIds.length > 0
            ? [notInArray(productEmbeddings.imageId, readyIds)]
            : []),
        ),
      )
  })
}

/**
 * Queues embeddings for products on sale that have none from `model`, for a
 * product or a ready photo, newest first: those approved while AI was off,
 * and all of them after a change of embedding model. Returns how many were
 * queued.
 */
export async function queueMissingEmbeddings(
  db: Database,
  queue: Pick<JobQueue, 'send'>,
  model: string,
  limit = EMBED_MISSING_BATCH,
): Promise<number> {
  return db.transaction(async (tx) => {
    const missing = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.status, 'approved'),
          isNull(products.deletedAt),
          sql`(
            not exists (
              select 1 from ${productEmbeddings} e
              where e.product_id = ${products.id} and e.kind = 'text' and e.model = ${model}
            )
            or exists (
              select 1 from ${productImages} i
              where i.product_id = ${products.id} and i.status = 'ready'
                and not exists (
                  select 1 from ${productEmbeddings} e
                  where e.image_id = i.id and e.model = ${model}
                )
            )
          )`,
        ),
      )
      .orderBy(desc(products.publishedAt), desc(products.id))
      .limit(limit)
    for (const { id } of missing) await queueProductEmbeddings(tx, queue, id)
    return missing.length
  })
}
