import { z } from 'zod'
import {
  gstin,
  indianMobile,
  pan,
  phoneNumber,
  pincode,
  stateCode,
  strictObject,
  text,
  wholeNumber,
} from '../../lib/validation.ts'

export type SellerStatus = 'pending' | 'approved' | 'suspended'

/** Details an administrator manages; they print on the seller's invoices. */
export const businessDetails = strictObject({
  displayName: text(100),
  legalName: text(200),
  gstin: gstin.nullable(),
  pan: pan.nullable(),
  line1: text(200),
  city: text(100),
  stateCode,
  pincode,
  supportEmail: z.email('must be an email address'),
  supportPhone: phoneNumber,
  invoicePrefix: z
    .string()
    .regex(/^[A-Z0-9]{1,6}$/, 'must be 1 to 6 capital letters or digits'),
  // Null uses the platform commission from settings.
  commissionBps: wholeNumber(0, 10_000).nullable(),
})
export type BusinessDetails = z.infer<typeof businessDetails>

export const newSeller = businessDetails.extend({
  owner: strictObject({
    email: z.email('must be an email address'),
    name: text(100),
    phoneNumber: indianMobile.nullable().default(null),
  }),
})
export type NewSeller = z.infer<typeof newSeller>

export const businessUpdate = businessDetails.partial()

/** The only details a seller may change about their own business. */
export const contactsUpdate = businessDetails
  .pick({ displayName: true, supportEmail: true, supportPhone: true })
  .partial()

export const suspension = strictObject({ reason: text(500) })

/**
 * Rules that span fields: the PAN sits inside the GSTIN, and a GSTIN starts
 * with the state code of the business it belongs to.
 */
export function taxIdIssues(details: {
  gstin: string | null
  pan: string | null
  stateCode: string
}): string[] {
  const issues: string[] = []
  if (
    details.gstin &&
    details.pan &&
    details.gstin.slice(2, 12) !== details.pan
  ) {
    issues.push('gstin must contain the PAN as its 3rd to 12th characters')
  }
  if (details.gstin && details.gstin.slice(0, 2) !== details.stateCode) {
    issues.push(
      `gstin must start with the state code of the address (${details.stateCode})`,
    )
  }
  return issues
}

/** A seller as the admin console and the seller portal show it. */
export interface SellerView {
  id: string
  slug: string
  ownerUserId: string
  status: SellerStatus
  displayName: string
  legalName: string
  gstin: string | null
  pan: string | null
  line1: string
  city: string
  stateCode: string
  pincode: string
  supportEmail: string
  supportPhone: string
  invoicePrefix: string
  commissionBps: number | null
  approvedAt: Date | null
  suspendedReason: string | null
  createdAt: Date
  updatedAt: Date
}
