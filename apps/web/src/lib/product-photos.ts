import type { ImageLoader } from 'next/image'

/*
 * Product photos in next/image (backend spec step 9). The worker stores each
 * photo in three sizes at fixed addresses, and design doc section 7 says
 * they are served pre-sized from the CDN, never resized on the fly. So this
 * loader picks the smallest stored size at least as wide as the browser
 * asks for, instead of sending photos through Next.js's image optimiser:
 *
 *   <Image loader={productPhotoLoader} src={photoSource(image)}
 *     width={image.width} height={image.height} alt={image.alt} sizes="..." />
 *
 * It is used in client components, so it cannot import @ecokart/core; a test
 * checks these sizes against the worker's (IMAGE_SIZES in lib/images.ts).
 */

export const PHOTO_SIZES = [
  ['thumb', 160],
  ['card', 480],
  ['gallery', 1200],
] as const

/** The photo's address without a size, which `productPhotoLoader` expects. */
export const photoSource = (image: { urls: { gallery: string } }): string =>
  image.urls.gallery.replace(/\/gallery\.webp$/, '')

export const productPhotoLoader: ImageLoader = ({ src, width }) => {
  const [name] =
    PHOTO_SIZES.find(([, pixels]) => pixels >= width) ?? PHOTO_SIZES.at(-1)!
  return `${src}/${name}.webp`
}
