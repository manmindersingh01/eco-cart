import { parsePercentToBasisPoints } from './admin-settings'

export type SellerStatus = 'pending' | 'approved' | 'suspended'

export type SellerSummary = {
  id: string
  slug: string
  displayName: string
  legalName: string
  status: SellerStatus
  city: string
  stateCode: string
  createdAt: string
}

export type SellerDetail = {
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
  owner: {
    email: string
    name: string
    phoneNumber: string | null
    banned: boolean
    banReason: string | null
  } | null
}

export type BusinessFormValues = {
  displayName: string
  legalName: string
  gstin: string
  pan: string
  line1: string
  city: string
  stateCode: string
  pincode: string
  supportEmail: string
  supportPhone: string
  invoicePrefix: string
  commissionPercent: string
}

export type OwnerFormValues = {
  email: string
  name: string
  phoneNumber: string
}

export type SellerFormValues = BusinessFormValues & {
  owner: OwnerFormValues
}

export type SerialiseResult<T> =
  { ok: true; value: T } | { ok: false; error: string }

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function serialiseBusiness(values: BusinessFormValues) {
  const commission = nullable(values.commissionPercent)
  const parsedCommission = commission
    ? parsePercentToBasisPoints(commission)
    : null
  if (parsedCommission && !parsedCommission.ok) return parsedCommission

  return {
    ok: true as const,
    value: {
      displayName: values.displayName,
      legalName: values.legalName,
      gstin: nullable(values.gstin),
      pan: nullable(values.pan),
      line1: values.line1,
      city: values.city,
      stateCode: values.stateCode,
      pincode: values.pincode,
      supportEmail: values.supportEmail,
      supportPhone: values.supportPhone,
      invoicePrefix: values.invoicePrefix,
      commissionBps: parsedCommission?.value ?? null,
    },
  }
}

export function serialiseNewSeller(
  values: SellerFormValues,
): SerialiseResult<unknown> {
  const business = serialiseBusiness(values)
  if (!business.ok) return business
  return {
    ok: true,
    value: {
      ...business.value,
      owner: {
        email: values.owner.email,
        name: values.owner.name,
        phoneNumber: nullable(values.owner.phoneNumber),
      },
    },
  }
}

export function serialiseBusinessUpdate(
  values: BusinessFormValues,
): SerialiseResult<unknown> {
  return serialiseBusiness(values)
}

export function businessValuesFromSeller(
  seller: SellerDetail,
): BusinessFormValues {
  return {
    displayName: seller.displayName,
    legalName: seller.legalName,
    gstin: seller.gstin ?? '',
    pan: seller.pan ?? '',
    line1: seller.line1,
    city: seller.city,
    stateCode: seller.stateCode,
    pincode: seller.pincode,
    supportEmail: seller.supportEmail,
    supportPhone: seller.supportPhone,
    invoicePrefix: seller.invoicePrefix,
    commissionPercent:
      seller.commissionBps === null
        ? ''
        : basisPointsInput(seller.commissionBps),
  }
}

function basisPointsInput(value: number): string {
  const whole = Math.floor(value / 100)
  const fraction = String(value % 100)
    .padStart(2, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function sellerListHref(
  status?: SellerStatus,
  cursor?: string,
): '/admin/sellers' | `/admin/sellers?${string}` {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  if (cursor) query.set('cursor', cursor)
  const encoded = query.toString()
  return encoded ? `/admin/sellers?${encoded}` : '/admin/sellers'
}

export function sellerDetailHref(id: string): `/admin/sellers/${string}` {
  return `/admin/sellers/${id}`
}

export function isSellerStatus(value: unknown): value is SellerStatus {
  return value === 'pending' || value === 'approved' || value === 'suspended'
}

export function lifecycleActions(
  status: SellerStatus,
  hasTaxDetails: boolean,
): {
  approve: boolean
  approveDisabledReason: string | null
  suspend: boolean
  reinstate: boolean
} {
  return {
    approve: status === 'pending',
    approveDisabledReason:
      status === 'pending' && !hasTaxDetails
        ? 'Add both GSTIN and PAN before approval.'
        : null,
    suspend: status === 'pending' || status === 'approved',
    reinstate: status === 'suspended',
  }
}

export function highImpactBusinessChanges(
  initial: BusinessFormValues,
  current: BusinessFormValues,
): string[] {
  const fields: Array<[keyof BusinessFormValues, string]> = [
    ['legalName', 'legal name'],
    ['gstin', 'GSTIN'],
    ['pan', 'PAN'],
    ['stateCode', 'GST state code'],
    ['invoicePrefix', 'invoice prefix'],
  ]
  return fields
    .filter(([key]) => initial[key] !== current[key])
    .map(([, label]) => label)
}
