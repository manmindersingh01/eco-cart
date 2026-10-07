import { describe, expect, test } from 'vitest'
import { destinationForRole, roleCanAccess, safeReturnTo } from './auth-routing'

describe('safeReturnTo', () => {
  test.each([
    ['/admin/settings?tab=company', '/admin/settings?tab=company'],
    ['/seller/products#drafts', '/seller/products#drafts'],
    ['/', '/'],
  ])('accepts the internal path %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected)
  })

  test.each([
    'https://example.com/admin',
    '//example.com/admin',
    '/\\example.com/admin',
    'javascript:alert(1)',
    'admin/settings',
    '/admin\n/settings',
    '',
  ])('rejects the unsafe path %s', (input) => {
    expect(safeReturnTo(input)).toBeNull()
  })
})

describe('role routing', () => {
  test.each([
    ['admin', '/admin'],
    ['seller', '/seller'],
    ['buyer', '/'],
  ] as const)('routes %s to %s by default', (role, destination) => {
    expect(destinationForRole(role)).toBe(destination)
  })

  test('uses a safe return path before the role default', () => {
    expect(destinationForRole('admin', '/admin/settings')).toBe(
      '/admin/settings',
    )
  })

  test('ignores an unsafe return path', () => {
    expect(destinationForRole('seller', '//example.com')).toBe('/seller')
  })

  test('allows only the matching portal role', () => {
    expect(roleCanAccess('admin', 'admin')).toBe(true)
    expect(roleCanAccess('seller', 'seller')).toBe(true)
    expect(roleCanAccess('buyer', 'admin')).toBe(false)
    expect(roleCanAccess('admin', 'seller')).toBe(false)
  })
})
