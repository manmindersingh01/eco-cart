import { connection } from 'next/server'
import { handleErrors } from '@/lib/api'
import { readHomePage } from '@/lib/storefront'

/** The home page: new arrivals, then a row per top-level category. */
export const GET = handleErrors(async () => {
  // Answered per request from the cache, never prerendered by `next build`,
  // which has no database.
  await connection()
  const sections = await readHomePage()
  return Response.json({ sections })
})
