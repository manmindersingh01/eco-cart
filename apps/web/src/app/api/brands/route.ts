import { handleErrors, pageQuery } from '@/lib/api'
import { getPublicBrands } from '@/lib/public-catalogue'

/** Active brands A to Z: `?q=bamboo&cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const q = new URL(request.url).searchParams.get('q')
  const page = await getPublicBrands({
    ...(q ? { q } : {}),
    ...pageQuery(request),
  })
  return Response.json(page)
})
