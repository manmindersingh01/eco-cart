import { describe, expect, test } from 'vitest'
import {
  highImpactBusinessChanges,
  lifecycleActions,
  sellerListHref,
  serialiseNewSeller,
  type SellerFormValues,
} from './admin-sellers'

const values: SellerFormValues = {
  owner: { email: 'owner@example.test', name: 'Owner', phoneNumber: '' },
  displayName: 'Green Basket',
  legalName: 'Green Basket LLP',
  gstin: '',
  pan: '',
  line1: '1 Market Road',
  city: 'Pune',
  stateCode: '27',
  pincode: '411001',
  supportEmail: 'care@example.test',
  supportPhone: '+919812345678',
  invoicePrefix: 'GREEN',
  commissionPercent: '',
}

describe('seller form serialization', () => {
  test('sends optional tax, owner phone, and commission values as null', () => {
    expect(serialiseNewSeller(values)).toEqual({
      ok: true,
      value: {
        owner: {
          email: 'owner@example.test',
          name: 'Owner',
          phoneNumber: null,
        },
        displayName: 'Green Basket',
        legalName: 'Green Basket LLP',
        gstin: null,
        pan: null,
        line1: '1 Market Road',
        city: 'Pune',
        stateCode: '27',
        pincode: '411001',
        supportEmail: 'care@example.test',
        supportPhone: '+919812345678',
        invoicePrefix: 'GREEN',
        commissionBps: null,
      },
    })
  })

  test('converts a seller commission percentage to basis points', () => {
    const result = serialiseNewSeller({
      ...values,
      commissionPercent: '8.25',
    })
    expect(result).toMatchObject({
      ok: true,
      value: { commissionBps: 825 },
    })
  })
})

describe('seller list and lifecycle presentation', () => {
  test('keeps the status and opaque cursor in the URL', () => {
    expect(sellerListHref('pending')).toBe('/admin/sellers?status=pending')
    expect(sellerListHref('approved', 'opaque/+value=')).toBe(
      '/admin/sellers?status=approved&cursor=opaque%2F%2Bvalue%3D',
    )
  })

  test('shows only lifecycle actions possible for the current state', () => {
    expect(lifecycleActions('pending', false)).toEqual({
      approve: true,
      approveDisabledReason: 'Add both GSTIN and PAN before approval.',
      suspend: true,
      reinstate: false,
    })
    expect(lifecycleActions('approved', true)).toMatchObject({
      approve: false,
      suspend: true,
      reinstate: false,
    })
    expect(lifecycleActions('suspended', true)).toMatchObject({
      approve: false,
      suspend: false,
      reinstate: true,
    })
  })

  test('identifies legal, tax, state, and invoice changes for confirmation', () => {
    expect(
      highImpactBusinessChanges(values, {
        ...values,
        pan: 'AAACE1234F',
        invoicePrefix: 'NEW',
      }),
    ).toEqual(['PAN', 'invoice prefix'])
  })
})
