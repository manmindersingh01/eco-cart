import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { encryptionKey, parseEnv, secretString } from './config.ts'

const developmentKey = Buffer.from('development-only-encryption-key!').toString(
  'base64',
)
const realKey = Buffer.alloc(32, 9).toString('base64')

const schemaFor = (env: NodeJS.ProcessEnv) =>
  z.object({
    SECRET: secretString(env, 32),
    KEY: encryptionKey(env),
  })

describe('parseEnv', () => {
  test('accepts the development example values outside production', () => {
    const env = {
      NODE_ENV: 'development',
      SECRET: 'development-only-secret-0123456789abcdef',
      KEY: developmentKey,
    }
    expect(parseEnv(schemaFor(env), env).KEY).toHaveLength(32)
  })

  test('refuses the development example values in production', () => {
    const env = {
      NODE_ENV: 'production',
      SECRET: 'development-only-secret-0123456789abcdef',
      KEY: developmentKey,
    }
    expect(() => parseEnv(schemaFor(env), env)).toThrow(
      /SECRET is the development example value[\s\S]*KEY is the development example value/,
    )
  })

  test('accepts real values in production', () => {
    const env = {
      NODE_ENV: 'production',
      SECRET: 'a'.repeat(40),
      KEY: realKey,
    }
    expect(parseEnv(schemaFor(env), env).SECRET).toBe('a'.repeat(40))
  })

  test('names every problem without printing values', () => {
    const env = { SECRET: 'short-secret-value', KEY: 'abc' }
    let message = ''
    try {
      parseEnv(schemaFor(env), env)
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toContain('SECRET must be at least 32 characters')
    expect(message).toContain(
      'KEY MESSAGE_ENCRYPTION_KEY must be 32 random bytes',
    )
    expect(message).not.toContain('short-secret-value')
  })
})
