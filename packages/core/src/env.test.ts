import { describe, expect, test } from 'vitest'
import { requireEnv } from './env.ts'

describe('requireEnv', () => {
  test('returns the value when the variable is set', () => {
    expect(requireEnv('DATABASE_URL', { DATABASE_URL: 'postgres://db' })).toBe(
      'postgres://db',
    )
  })

  test('throws when the variable is missing', () => {
    expect(() => requireEnv('DATABASE_URL', {})).toThrow(
      'Missing required environment variable DATABASE_URL',
    )
  })

  test('throws when the variable is blank', () => {
    expect(() => requireEnv('DATABASE_URL', { DATABASE_URL: '  ' })).toThrow(
      'Missing required environment variable DATABASE_URL',
    )
  })
})
