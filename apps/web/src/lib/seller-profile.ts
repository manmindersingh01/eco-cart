export type SellerStatus = 'pending' | 'approved' | 'suspended'

export type SellerProfile = {
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
  approvedAt: string | null
  suspendedReason: string | null
  createdAt: string
  updatedAt: string
}

export type SellerContactValues = Pick<
  SellerProfile,
  'displayName' | 'supportEmail' | 'supportPhone'
>

export function contactValuesFromSeller(
  seller: SellerProfile,
): SellerContactValues {
  return {
    displayName: seller.displayName,
    supportEmail: seller.supportEmail,
    supportPhone: seller.supportPhone,
  }
}

export function changedSellerContacts(
  initial: SellerContactValues,
  current: SellerContactValues,
): Partial<SellerContactValues> | null {
  const changes: Partial<SellerContactValues> = {}
  const keys = [
    'displayName',
    'supportEmail',
    'supportPhone',
  ] as const satisfies readonly (keyof SellerContactValues)[]

  for (const key of keys) {
    if (current[key] !== initial[key]) changes[key] = current[key]
  }

  return Object.keys(changes).length > 0 ? changes : null
}

export function sellerCommissionLabel(commissionBps: number | null): string {
  if (commissionBps === null) return 'Platform rate'
  return formatBasisPoints(commissionBps)
}

export function sellerStatusPresentation(status: SellerStatus): {
  label: string
  tone: 'success' | 'warning' | 'danger'
  title: string
  description: string
} {
  if (status === 'approved') {
    return {
      label: 'Approved',
      tone: 'success',
      title: 'Your business is approved',
      description:
        'You can manage your catalogue and sell products on EcoKart.',
    }
  }
  if (status === 'suspended') {
    return {
      label: 'Suspended',
      tone: 'danger',
      title: 'Your business is suspended',
      description:
        'Your products are not public. Contact EcoKart support about the reason shown below.',
    }
  }
  return {
    label: 'Pending',
    tone: 'warning',
    title: 'Approval is pending',
    description:
      'You may prepare draft listings, but they cannot be sold publicly until an administrator approves your business.',
  }
}
import { formatBasisPoints } from './format'
