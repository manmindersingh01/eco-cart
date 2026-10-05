import { describe, expect, test } from 'vitest'
import { scramSha256Verifier } from './scram.ts'

describe('scramSha256Verifier', () => {
  test('produces the format PostgreSQL stores in pg_authid', () => {
    expect(scramSha256Verifier('ecokart_web')).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/,
    )
  })

  test('is the same for the same password and salt', () => {
    const salt = Buffer.alloc(16, 7)
    expect(scramSha256Verifier('secret', salt)).toBe(
      scramSha256Verifier('secret', salt),
    )
  })

  test('uses a fresh salt each time by default', () => {
    expect(scramSha256Verifier('secret')).not.toBe(
      scramSha256Verifier('secret'),
    )
  })

  test('refuses passwords PostgreSQL would normalise differently', () => {
    expect(() => scramSha256Verifier('pass word')).toThrow('printable ASCII')
    expect(() => scramSha256Verifier('pässword')).toThrow('printable ASCII')
    expect(() => scramSha256Verifier('')).toThrow('printable ASCII')
  })
})
