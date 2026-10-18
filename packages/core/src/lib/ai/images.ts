import { isLocalHost } from './client.ts'

/*
 * Photos go to the models as addresses the provider fetches itself: the
 * card-size photo on CloudFront in production (AGENTS.md). In development the
 * photos live on http://localhost:8333, which a remote provider such as
 * OpenRouter cannot reach, so such a photo is sent inline as a data URL
 * instead. A local provider, such as the test server, gets the address as it
 * is.
 */

export interface ImageForAi {
  /** Where the photo is served, for example its card size on CloudFront. */
  url: string
  /** The photo's bytes, read only when they must be sent inline. */
  read: () => Promise<Buffer | null>
  contentType: string
}

/**
 * The address to send `image` to a model of `provider` with, or null when it
 * must go inline and its bytes are missing.
 */
export async function imageAddressForAi(
  image: ImageForAi,
  provider: string,
): Promise<string | null> {
  const local = isLocalHost(new URL(image.url).hostname)
  if (!local || provider === 'local') return image.url
  const bytes = await image.read()
  return bytes
    ? `data:${image.contentType};base64,${bytes.toString('base64')}`
    : null
}
