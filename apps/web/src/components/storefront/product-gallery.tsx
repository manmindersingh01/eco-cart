'use client'

import Image from 'next/image'
import { useState } from 'react'
import { NoPhoto, ProductPhoto, type ProductPhotoImage } from './product-photo'
import { cx } from '@/lib/classes'

type GalleryImage = ProductPhotoImage & { id: string }

/**
 * The product's photos, main photo first, then its video once the worker
 * has converted it. The video never plays by itself.
 */
export function ProductGallery({
  title,
  images,
  video,
}: {
  title: string
  images: readonly GalleryImage[]
  video: {
    url: string
    posterUrl: string
    width: number
    height: number
  } | null
}) {
  const [index, setIndex] = useState(0)
  const [showVideo, setShowVideo] = useState(false)
  const current = images[index]

  return (
    <div className="grid gap-3">
      <div className="relative aspect-square overflow-hidden rounded-xl border bg-surface-subtle">
        {showVideo && video ? (
          // Sellers cannot add captions to a product video yet, so there is
          // no caption track to offer; the page's text describes the product.
          // oxlint-disable-next-line jsx-a11y/media-has-caption
          <video
            controls
            playsInline
            preload="none"
            poster={video.posterUrl}
            width={video.width}
            height={video.height}
            className="h-full w-full bg-black object-contain"
          >
            <source src={video.url} type="video/mp4" />
          </video>
        ) : current ? (
          <ProductPhoto
            image={current}
            sizes="(min-width: 1024px) 50vw, 100vw"
            priority
            className="object-contain"
          />
        ) : (
          <NoPhoto />
        )}
      </div>
      {images.length + (video ? 1 : 0) > 1 ? (
        <ul className="flex flex-wrap gap-2" aria-label={`Photos of ${title}`}>
          {images.map((image, position) => {
            const selected = !showVideo && position === index
            return (
              <li key={image.id}>
                <button
                  type="button"
                  aria-label={`Show photo ${position + 1} of ${images.length}`}
                  aria-pressed={selected}
                  onClick={() => {
                    setIndex(position)
                    setShowVideo(false)
                  }}
                  className={cx(
                    'block size-16 overflow-hidden rounded-lg border-2 bg-surface-subtle sm:size-20',
                    selected
                      ? 'border-brand'
                      : 'border-transparent hover:border-border',
                  )}
                >
                  <ProductPhoto image={image} sizes="80px" />
                </button>
              </li>
            )
          })}
          {video ? (
            <li>
              <button
                type="button"
                aria-label="Play the product video"
                aria-pressed={showVideo}
                onClick={() => setShowVideo(true)}
                className={cx(
                  'relative flex size-16 items-center justify-center overflow-hidden rounded-lg border-2 bg-black sm:size-20',
                  showVideo
                    ? 'border-brand'
                    : 'border-transparent hover:border-border',
                )}
              >
                {/* The poster is a still from the video, already resized. */}
                <Image
                  src={video.posterUrl}
                  alt=""
                  fill
                  unoptimized
                  sizes="80px"
                  className="object-cover opacity-80"
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="relative size-8 text-white drop-shadow"
                  fill="currentColor"
                >
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
