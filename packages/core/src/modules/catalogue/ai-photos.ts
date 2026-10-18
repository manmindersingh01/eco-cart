import { and, asc, eq } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { productImages } from '../../db/schema/index.ts'
import { imageAddressForAi } from '../../lib/ai/images.ts'
import { imageSizeKey } from '../../lib/images.ts'
import type { ObjectStorage } from '../../lib/storage.ts'

/*
 * A product's photos as the AI features show them to the vision model
 * (screening, step 20, and the listing builder, step 19): the ready card
 * sizes in the seller's order.
 */

export interface ProductPhotoForAi {
  /** The card size's public address. */
  url: string
  storageKey: string
}

/** A photo the vision model is shown, and its number in the seller's order. */
export interface PhotoToSend {
  url: string
  address: string
  number: number
}

/** The product's ready photos, in the order the seller set. */
export async function readyPhotosForAi(
  tx: Transaction,
  storage: Pick<ObjectStorage, 'publicUrl'>,
  productId: string,
): Promise<ProductPhotoForAi[]> {
  const photos = await tx
    .select({ storageKey: productImages.storageKey })
    .from(productImages)
    .where(
      and(
        eq(productImages.productId, productId),
        eq(productImages.status, 'ready'),
      ),
    )
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
  return photos.map(({ storageKey }) => ({
    storageKey,
    url: storage.publicUrl(imageSizeKey(storageKey, 'card')),
  }))
}

/**
 * The photos the vision model can be shown. One whose card size cannot be
 * read is left out and the others keep their numbers, so what the model
 * says about a photo always names the photo the seller sees.
 */
export async function photosToSend(
  storage: Pick<ObjectStorage, 'read'>,
  photos: ProductPhotoForAi[],
  provider: string,
): Promise<PhotoToSend[]> {
  const addresses = await Promise.all(
    photos.map((photo) =>
      imageAddressForAi(
        {
          url: photo.url,
          read: () => storage.read(imageSizeKey(photo.storageKey, 'card')),
          contentType: 'image/webp',
        },
        provider,
      ),
    ),
  )
  return photos.flatMap((photo, index) => {
    const address = addresses[index]
    return address ? [{ url: photo.url, address, number: index + 1 }] : []
  })
}
