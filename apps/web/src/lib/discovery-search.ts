import { apiRequest, ApiError } from './api-client'

export const searchPhotoTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const
export const maxSearchPhotoBytes = 5 * 1024 * 1024

export function checkSearchPhoto(
  file: Pick<File, 'type' | 'size'>,
): string | null {
  if (!searchPhotoTypes.some((type) => type === file.type))
    return 'Choose a JPEG, PNG or WebP photo.'
  if (file.size < 1 || file.size > maxSearchPhotoBytes)
    return 'Choose a photo larger than 0 bytes and no larger than 5 MB.'
  return null
}

const discoveryKeys = [
  'q',
  'photo',
  'category',
  'brand',
  'minPricePaise',
  'maxPricePaise',
  'includeOutOfStock',
  'cursor',
  'limit',
] as const

export function discoveryRequest(
  mode: 'natural' | 'photo',
  values: Record<string, string | undefined>,
): string {
  const query = new URLSearchParams()
  for (const key of discoveryKeys) {
    if (
      (key === 'q' && mode !== 'natural') ||
      (key === 'photo' && mode !== 'photo')
    )
      continue
    const value = values[key]
    if (value) query.set(key, value)
  }
  return `/api/search/${mode}?${query}`
}

export function naturalHref(
  values: Record<string, string | undefined>,
  changes: Record<string, string | undefined>,
): `/search?${string}` {
  const next = { ...values, ...changes }
  if (!('cursor' in changes)) delete next.cursor
  const params = new URLSearchParams({ mode: 'natural' })
  for (const key of discoveryKeys)
    if (key !== 'photo' && next[key]) params.set(key, next[key])
  return `/search?${params}`
}

export async function uploadSearchPhoto(
  file: File,
  signal: AbortSignal,
): Promise<string> {
  const problem = checkSearchPhoto(file)
  if (problem) throw new Error(problem)
  const { upload } = await apiRequest<{
    upload: {
      key: string
      url: string
      fields: Record<string, string>
      maxBytes: number
    }
  }>('/api/search/photo/uploads', {
    method: 'POST',
    json: { contentType: file.type, size: file.size },
    signal,
  })
  if (file.size > upload.maxBytes)
    throw new Error('The photo exceeds the server upload limit.')
  const body = new FormData()
  for (const [key, value] of Object.entries(upload.fields))
    body.append(key, value)
  body.append('file', file)
  const response = await fetch(upload.url, {
    method: 'POST',
    body,
    signal,
    credentials: 'omit',
  })
  if (!response.ok)
    throw new Error('The photo upload failed. Choose the photo again to retry.')
  return upload.key
}

export function discoveryProblem(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'TimeoutError')
    return 'The search timed out. Try again or use keyword search.'
  if (cause instanceof ApiError) {
    if (cause.status === 429)
      return 'Search is busy or its daily allowance is used up. Wait before retrying, or use keyword search.'
    if (cause.status === 503)
      return 'This search mode is unavailable right now. Try again later or use keyword search.'
    if (cause.status === 400)
      return 'These search details could not be used. Check the filters, or choose the photo again.'
  }
  return 'The search could not finish. Try again or use keyword search.'
}
