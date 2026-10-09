import { describe, expect, test } from 'vitest'
import {
  changedSellerContacts,
  sellerCommissionLabel,
  sellerStatusPresentation,
  type SellerContactValues,
} from './seller-profile'

const contacts: SellerContactValues = {
  displayName: 'Green Basket',
  supportEmail: 'care@greenbasket.test',
  supportPhone: '+919812345678',
}

describe('seller contact changes', () => {
  test('does not submit an unchanged form', () => {
    expect(changedSellerContacts(contacts, { ...contacts })).toBeNull()
  })

  test('sends only the fields that changed', () => {
    expect(
      changedSellerContacts(contacts, {
        ...contacts,
        supportEmail: 'help@greenbasket.test',
      }),
    ).toEqual({ supportEmail: 'help@greenbasket.test' })
  })

  test('can send all three editable fields together', () => {
    expect(
      changedSellerContacts(contacts, {
        displayName: 'Green Basket India',
        supportEmail: 'help@greenbasket.test',
        supportPhone: '+919876543210',
      }),
    ).toEqual({
      displayName: 'Green Basket India',
      supportEmail: 'help@greenbasket.test',
      supportPhone: '+919876543210',
    })
  })
})

describe('seller profile presentation', () => {
  test('does not present a missing seller commission as zero', () => {
    expect(sellerCommissionLabel(null)).toBe('Platform rate')
    expect(sellerCommissionLabel(825)).toBe('8.25%')
  })

  test('explains pending and approved catalogue access', () => {
    expect(sellerStatusPresentation('pending')).toMatchObject({
      label: 'Pending',
      tone: 'warning',
      description: expect.stringContaining('draft listings'),
    })
    expect(sellerStatusPresentation('approved')).toMatchObject({
      label: 'Approved',
      tone: 'success',
      description: expect.stringContaining('manage your catalogue'),
    })
  })

  test('presents suspended status without an action', () => {
    expect(sellerStatusPresentation('suspended')).toEqual({
      label: 'Suspended',
      tone: 'danger',
      title: 'Your business is suspended',
      description:
        'Your products are not public. Contact EcoKart support about the reason shown below.',
    })
  })
})
