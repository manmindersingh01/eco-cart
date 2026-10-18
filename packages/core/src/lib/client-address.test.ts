import { describe, expect, test } from 'vitest'
import { clientAddress, trustedProxyCount } from './client-address.ts'

const forwarded = (value: string) => new Headers({ 'x-forwarded-for': value })

describe('client address', () => {
  test('behind the load balancer alone, the last entry is the visitor', () => {
    // The visitor sent a made-up first entry; the load balancer appended the real one.
    expect(clientAddress(forwarded('10.0.0.1, 203.0.113.7'), 1)).toBe(
      '203.0.113.7',
    )
    expect(clientAddress(forwarded('203.0.113.7'), 1)).toBe('203.0.113.7')
  })

  test('with CloudFront in front, the second to last entry is the visitor', () => {
    expect(
      clientAddress(forwarded('10.0.0.1, 203.0.113.7, 130.176.0.5'), 2),
    ).toBe('203.0.113.7')
    // A request that skipped CloudFront has only one entry.
    expect(clientAddress(forwarded('203.0.113.7'), 2)).toBe('203.0.113.7')
  })

  test('is null without the header', () => {
    expect(clientAddress(new Headers(), 1)).toBeNull()
    expect(clientAddress(forwarded(' , '), 1)).toBeNull()
    expect(clientAddress(undefined, 1)).toBeNull()
    // x-real-ip is not set by our proxies, so a visitor could forge it.
    expect(clientAddress(new Headers({ 'x-real-ip': '1.2.3.4' }), 1)).toBeNull()
  })

  test('reads the number of proxies from TRUSTED_PROXY_COUNT', () => {
    expect(trustedProxyCount({})).toBe(1)
    expect(trustedProxyCount({ TRUSTED_PROXY_COUNT: '2' })).toBe(2)
    for (const value of ['0', '6', 'two', '1.5', '-1']) {
      expect(() => trustedProxyCount({ TRUSTED_PROXY_COUNT: value })).toThrow(
        'TRUSTED_PROXY_COUNT must be a whole number from 1 to 5',
      )
    }
  })
})
