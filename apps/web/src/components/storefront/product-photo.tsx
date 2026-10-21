'use client'

import Image from 'next/image'
import { photoSource, productPhotoLoader } from '@/lib/product-photos'
import { cx } from '@/lib/classes'

export type ProductPhotoImage = {
  alt: string
  width: number
  height: number
  urls: { thumb: string; card: string; gallery: string }
}

/**
 * A product photo at the stored size nearest the space it fills. A client
 * component because next/image takes the loader as a function.
 */
export function ProductPhoto({
  image,
  sizes,
  priority = false,
  className,
}: {
  image: ProductPhotoImage
  sizes: string
  priority?: boolean
  className?: string
}) {
  return (
    <Image
      loader={productPhotoLoader}
      src={photoSource(image)}
      width={image.width}
      height={image.height}
      alt={image.alt}
      sizes={sizes}
      priority={priority}
      className={cx('h-full w-full object-cover', className)}
    />
  )
}

/** Where a product has no ready photo yet. */
export function NoPhoto({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        'flex h-full w-full items-center justify-center bg-surface-subtle text-sm text-muted',
        className,
      )}
    >
      No photo yet
    </div>
  )
}
