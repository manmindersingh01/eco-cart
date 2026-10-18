import { connection } from 'next/server'
import { handleErrors } from '@/lib/api'
import { readCompanyDetails } from '@/lib/storefront'

/**
 * EcoKart's legal name, address, GSTIN, support contacts, and grievance
 * officer, for the storefront footer; 503 until an administrator saves them.
 */
export const GET = handleErrors(async () => {
  // Read at request time, never prerendered by `next build`.
  await connection()
  const company = await readCompanyDetails()
  return Response.json({ company })
})
