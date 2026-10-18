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
  AI_ENABLED: 'false',
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

  test('passes with AI switched on and pointed at OpenRouter', () => {
    expect(() =>
      checkWebSettings({
        NODE_ENV: 'production',
        ...realValues,
        AI_ENABLED: 'true',
        AI_BASE_URL: 'https://openrouter.ai/api/v1',
        AI_API_KEY: `sk-or-v1-${'c'.repeat(64)}`,
        AI_CHAT_MODEL: 'deepseek/deepseek-v4.1-flash',
        AI_VISION_MODEL: 'deepseek/deepseek-v4.1-flash',
        AI_EMBED_MODEL: 'voyageai/voyage-multimodal-3.5',
        AI_EMBED_DIMENSIONS: '1024',
      }),
    ).not.toThrow()
  })

  test('stops when AI is switched on without its key', () => {
    const { AI_ENABLED: _enabled, ...withoutSwitch } = realValues
    expect(() =>
      checkWebSettings({ NODE_ENV: 'production', ...withoutSwitch }),
    ).toThrow('AI_ENABLED must be true or false')
    expect(() =>
      checkWebSettings({
        NODE_ENV: 'production',
        ...realValues,
        AI_ENABLED: 'true',
      }),
    ).toThrow('AI_API_KEY is required when AI_ENABLED is true')
  })

  test('stops when only some Razorpay keys are set', () => {
    expect(() =>
      checkWebSettings({
        NODE_ENV: 'production',
        ...realValues,
        RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456',
      }),
    ).toThrow('must be set together, or none of them')
  })
})
