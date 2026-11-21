import Image from 'next/image'
import { NoPhoto } from '@/components/storefront/product-photo'

/**
 * A cart or order line's small photo. The address is the stored thumbnail
 * size already, so Next.js does not resize it again.
 */
export function LineThumbnail({ url }: { url: string | null }) {
  return (
    <div className="relative size-18 shrink-0 overflow-hidden rounded-lg border bg-surface-subtle sm:size-20">
      {url ? (
        <Image
          src={url}
          alt=""
          fill
          unoptimized
          sizes="80px"
          className="object-cover"
        />
      ) : (
        <NoPhoto className="text-center text-xs" />
      )}
    </div>
  )
}

/** A line's options as text, for example "Size: M · Colour: Blue". */
export function optionsText(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([name, value]) => `${name}: ${value}`)
    .join(' · ')
}
