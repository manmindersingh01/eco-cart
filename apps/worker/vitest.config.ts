import { testDatabase, testStorageEnv } from '@ecokart/core/testing'
import { defineConfig } from 'vitest/config'

const database = testDatabase('worker')

export default defineConfig({
  test: {
    // These tests talk to a real PostgreSQL, Mailpit, and object storage.
    // On a busy laptop or a small CI runner a few take several seconds, so
    // Vitest's 5-second default made them fail at random; a real hang still
    // fails at 20 seconds.
    testTimeout: 20_000,
    // Rebuilds ecokart_test_worker from the real migrations before every run.
    globalSetup: ['./vitest.global-setup.ts'],
    env: {
      DATABASE_URL: database.workerUrl,
      // For the tests that send jobs and sign in the way the web app does.
      WEB_DATABASE_URL: database.webUrl,
      // For test fixtures, such as a seller and a category.
      MIGRATION_DATABASE_URL: database.migrationUrl,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'development-only-secret-for-tests',
      // The Mailpit catcher from compose.yaml, or CI's service container.
      MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:8025',
      EMAIL_PROVIDER: 'mailpit',
      EMAIL_FROM: 'EcoKart <no-reply@ecokart.test>',
      SMS_PROVIDER: 'mailpit',
      // "development-only-encryption-key!" in base64.
      MESSAGE_ENCRYPTION_KEY: 'ZGV2ZWxvcG1lbnQtb25seS1lbmNyeXB0aW9uLWtleSE=',
      // Its own bucket on the compose.yaml storage service, or CI's.
      ...testStorageEnv('worker'),
    },
  },
})
