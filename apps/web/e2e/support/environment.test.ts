import { describe, expect, test } from 'vitest'
import {
  allocateEnvironment,
  assertTestResources,
  childEnvironment,
} from './environment.ts'

describe('E2E resource ownership', () => {
  test('P02 separates repeated allocations in one checkout', () => {
    const first = allocateEnvironment()
    const second = allocateEnvironment()
    expect(first.database.name).not.toBe(second.database.name)
    expect(first.storage.STORAGE_BUCKET).not.toBe(second.storage.STORAGE_BUCKET)
    assertTestResources(first)
    assertTestResources(second)
  })

  test('P06 refuses development targets and mismatched database URLs', () => {
    const resources = allocateEnvironment()
    resources.database.name = 'ecokart'
    expect(() => assertTestResources(resources)).toThrow('Refusing a database')
    const mismatched = allocateEnvironment()
    mismatched.database.webUrl =
      'postgres://ecokart_web:ecokart_web@localhost:15434/ecokart'
    expect(() => assertTestResources(mismatched)).toThrow('do not match')
    const bucket = allocateEnvironment()
    bucket.storage.STORAGE_BUCKET = 'ecokart'
    expect(() => assertTestResources(bucket)).toThrow('Refusing a bucket')
  })

  test('P06 refuses non-local services', () => {
    const resources = allocateEnvironment()
    resources.database.serverUrl = 'postgres://example.invalid/postgres'
    expect(() => assertTestResources(resources)).toThrow('loopback')
  })

  test('overrides provider and database settings for child processes', () => {
    const resources = allocateEnvironment()
    const env = childEnvironment(resources, 'http://127.0.0.1:3211')
    expect(env.DATABASE_URL).toBe(resources.database.webUrl)
    expect(env.MIGRATION_DATABASE_URL).toBe('')
    expect(env.AI_ENABLED).toBe('false')
    expect(env.RAZORPAY_KEY_ID).toBe('')
    expect(env.BETTER_AUTH_URL).toBe('http://127.0.0.1:3211')
  })
})
