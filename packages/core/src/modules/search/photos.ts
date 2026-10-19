import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Database } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { NotConfiguredError, ValidationError } from '../../errors.ts'
import { AiProviderError, AiReplyError } from '../../lib/ai/client.ts'
import { EMBEDDING_DIMENSIONS } from '../../lib/ai/embed.ts'
import { imageAddressForAi } from '../../lib/ai/images.ts'
import type { AiModels } from '../../lib/ai/index.ts'
import type { Page } from '../../lib/pagination.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import {
  parseInput,
  slug as slugFormat,
  strictObject,
  wholeNumber,
} from '../../lib/validation.ts'
import { callAi } from '../ai/service.ts'
import { loadCategoryTree } from '../catalogue/categories.ts'
import {
  listingFilters,
  listingParameters,
  listPublicProducts,
} from '../catalogue/storefront.ts'
import type { ProductCard } from '../catalogue/storefront-types.ts'
import { categoryFilter, logSearch } from './service.ts'

/*
 * Search by photo (backend spec step 18, design doc 6.8): the shopper's
 * photo goes straight from the browser to object storage with a signed
 * form, like every upload, and the search embeds it with the same
 * multimodal model as the product photos and lists the products with the
 * nearest photos. One embedding call per photo, made during the request
 * within a few seconds (design doc 10); later pages of the same photo come
 * from the cache. The photos are private and the bucket's rule for uploads
 * deletes them after a day.
 */

export const SEARCH_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const
/** A phone photo; the storefront shrinks larger ones before uploading. */
export const MAX_SEARCH_PHOTO_BYTES = 5 * 1024 * 1024
const UPLOAD_SECONDS = 5 * 60

export const PHOTO_EMBED_TIMEOUT_MS = 5000

const DAY_SECONDS = 24 * 60 * 60

const photoUpload = strictObject({
  contentType: z.enum(SEARCH_PHOTO_TYPES, {
    error: 'must be image/jpeg, image/png, or image/webp',
  }),
  size: wholeNumber(1, MAX_SEARCH_PHOTO_BYTES),
})

const PHOTO_KEY =
  /^uploads\/search\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const photoParameters = strictObject({
  photo: z.string().regex(PHOTO_KEY, 'must be the key of an uploaded photo'),
  category: slugFormat.optional(),
  ...listingParameters,
})

export interface SearchPhotoUpload {
  /** Pass it as `photo` to the search. */
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
  expiresAt: Date
}

/**
 * A signed form for uploading one photo to search with:
 * `{ "contentType": "image/jpeg", "size": 1800000 }`.
 */
export async function createSearchPhotoUpload(
  storage: Pick<ObjectStorage, 'createUploadForm'>,
  input: unknown,
  now: Date = new Date(),
): Promise<SearchPhotoUpload> {
  const { contentType } = parseInput(
    photoUpload,
    input,
    'That photo cannot be used',
  )
  const key = `uploads/search/${randomUUID()}`
  const form = await storage.createUploadForm(key, {
    contentType,
    maxBytes: MAX_SEARCH_PHOTO_BYTES,
    expiresInSeconds: UPLOAD_SECONDS,
  })
  return {
    key,
    ...form,
    maxBytes: MAX_SEARCH_PHOTO_BYTES,
    expiresAt: new Date(now.getTime() + UPLOAD_SECONDS * 1000),
  }
}

/** The photo's type from its first bytes, or null when it is none of ours. */
export function photoType(
  bytes: Buffer,
): (typeof SEARCH_PHOTO_TYPES)[number] | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

const NO_PHOTO = 'That photo cannot be searched with'

export interface PhotoSearchDependencies {
  /** Connected as ecokart_web: the AI call runs outside any transaction. */
  db: Database
  storage: ObjectStorage
  ai: AiModels | null
}

const ANONYMOUS = { role: 'anonymous' } as const

/**
 * One page of products whose photos are nearest to the uploaded photo,
 * nearest first, each product once. `query` is the request's query string:
 * `photo` (the upload's key), and the storefront list parameters and
 * `category`. A new search (no cursor) is logged.
 *
 * Refuses with 503 when AI is off or the provider does not answer in time,
 * and 429 when the platform's AI calls for the day are used up: unlike
 * words, a photo has no search to fall back to.
 */
export async function searchByPhoto(
  deps: PhotoSearchDependencies,
  query: Record<string, string>,
): Promise<Page<ProductCard>> {
  const started = performance.now()
  if (deps.ai === null) {
    throw new NotConfiguredError('Search by photo is switched off')
  }
  const parameters = parseInput(photoParameters, query, NO_PHOTO)
  const { photo: key, cursor, limit } = parameters

  let embedding: number[]
  try {
    const answer = await callAi(deps.db, ANONYMOUS, deps.ai, {
      feature: 'image_search',
      uses: 'embed',
      input: { photo: key },
      // Later pages of the same photo.
      cacheSeconds: DAY_SECONDS,
      schema: z
        .array(z.array(z.number()).length(EMBEDDING_DIMENSIONS))
        .length(1),
      run: async (embedder) => {
        const bytes = await deps.storage.read(key)
        if (!bytes) {
          throw new ValidationError(NO_PHOTO, [
            'the photo did not arrive; upload it again',
          ])
        }
        const type = photoType(bytes)
        if (!type || bytes.length > MAX_SEARCH_PHOTO_BYTES) {
          throw new ValidationError(NO_PHOTO, [
            'it must be a JPEG, PNG, or WebP photo of at most 5 MB',
          ])
        }
        // The provider fetches the private photo through a short-lived
        // link, or gets it inline when it cannot reach our storage.
        const url = await deps.storage.createDownloadUrl(key, {
          expiresInSeconds: 5 * 60,
          fileName: 'search-photo',
        })
        const address = await imageAddressForAi(
          { url, read: async () => bytes, contentType: type },
          embedder.provider,
        )
        return embedder.embed([{ imageUrl: address! }], {
          inputType: 'search_query',
          timeoutMs: PHOTO_EMBED_TIMEOUT_MS,
        })
      },
    })
    embedding = answer.value[0]!
  } catch (error) {
    if (error instanceof AiProviderError || error instanceof AiReplyError) {
      throw new NotConfiguredError(
        'Search by photo is not available right now; try again in a moment',
      )
    }
    throw error
  }

  return withContext(deps.db, ANONYMOUS, async (tx) => {
    const tree = await loadCategoryTree(tx)
    const categoryIds = categoryFilter(tree, parameters.category)
    const page = await listPublicProducts(
      tx,
      deps.storage,
      {
        filters: {
          ...(await listingFilters(tx, parameters)),
          ...(categoryIds ? { categoryIds } : {}),
        },
        match: { kind: 'photo', embedding },
        sort: 'relevance',
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      },
      tree,
    )
    if (!cursor) {
      await logSearch(tx, {
        kind: 'image',
        queryText: null,
        resultCount: page.items.length,
        started,
      })
    }
    return page
  })
}
