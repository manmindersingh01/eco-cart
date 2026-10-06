import { describe, expect, test } from 'vitest'
import { checkWebSettings } from './settings'

/*
 * The server runs this check when it starts (src/instrumentation-node.ts)
 * and stops if it fails.
 */

const realValues = {
  DATABASE_URL: 'postgres://ecokart_web:secret@db.internal:5432/ecokart',
  BETTER_AUTH_URL: 'https://ecokart.example',
  BETTER_AUTH_SECRET: 'b'.repeat(48),
  MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  SMS_PROVIDER: 'none',
  STORAGE_BUCKET: 'ecokart-prod',
  STORAGE_REGION: 'ap-south-1',
  STORAGE_PUBLIC_URL: 'https://images.ecokart.example',
}

describe('checkWebSettings', () => {
  test('passes with real production values', () => {
    expect(() =>
      checkWebSettings({ NODE_ENV: 'production', ...realValues }),
    ).not.toThrow()
  })

  test('stops on a missing database address', () => {
    const { DATABASE_URL: _url, ...withoutDatabase } = realValues
    expect(() =>
      checkWebSettings({ NODE_ENV: 'production', ...withoutDatabase }),
    ).toThrow('Missing required environment variable DATABASE_URL')
  })

  test('stops on the example secrets and the local catcher in production', () => {
    expect(() =>
      checkWebSettings({
        NODE_ENV: 'production',
        ...realValues,
        BETTER_AUTH_SECRET: 'development-only-secret-replace-in-production',
        SMS_PROVIDER: 'mailpit',
      }),
    ).toThrow(
      /BETTER_AUTH_SECRET is the development example value[\s\S]*SMS_PROVIDER is the local Mailpit catcher/,
    )
  })
})
