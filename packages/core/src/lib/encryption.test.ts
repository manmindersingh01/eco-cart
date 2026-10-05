import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { openSecret, parseEncryptionKey, sealSecret } from './encryption.ts'

const key = randomBytes(32)

describe('sealSecret and openSecret', () => {
  test('round-trips a code without storing it readably', () => {
    const sealed = sealSecret('482913', key)
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+$/)
    expect(sealed).not.toContain('482913')
    expect(openSecret(sealed, key)).toBe('482913')
  })

  test('seals the same code differently every time', () => {
    expect(sealSecret('482913', key)).not.toBe(sealSecret('482913', key))
  })

  test('refuses a value sealed with another key', () => {
    const sealed = sealSecret('482913', randomBytes(32))
    expect(() => openSecret(sealed, key)).toThrow('unable to authenticate data')
  })

  test('refuses a value that was tampered with', () => {
    const [version, iv, data] = sealSecret('482913', key).split('.')
    // Flip one bit of the ciphertext itself. Editing a base64 character
    // instead can land on padding bits and change nothing.
    const bytes = Buffer.from(data!, 'base64url')
    bytes[0] = bytes[0]! ^ 0x01
    const tampered = `${version}.${iv}.${bytes.toString('base64url')}`
    expect(() => openSecret(tampered, key)).toThrow(
      'unable to authenticate data',
    )
  })

  test('refuses something that is not a sealed secret', () => {
    expect(() => openSecret('482913', key)).toThrow('Not a sealed secret')
  })
})

describe('parseEncryptionKey', () => {
  test('accepts 32 bytes of base64', () => {
    expect(parseEncryptionKey(key.toString('base64'))).toEqual(key)
  })

  test('refuses a key of the wrong length', () => {
    expect(() =>
      parseEncryptionKey(randomBytes(16).toString('base64')),
    ).toThrow('32 random bytes')
  })
})
