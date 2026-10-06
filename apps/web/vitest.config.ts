import { fileURLToPath } from 'node:url'
import { testDatabase, testStorageEnv } from '@ecokart/core/testing'
import { defineConfig } from 'vitest/config'

const database = testDatabase('web')

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Rebuilds ecokart_test_web from the real migrations before every run.
    globalSetup: ['./vitest.global-setup.ts'],
    env: {
      DATABASE_URL: database.webUrl,
      // For test fixtures and reading queued codes back.
      MIGRATION_DATABASE_URL: database.migrationUrl,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'development-only-secret-for-tests',
      // "development-only-encryption-key!" in base64.
      MESSAGE_ENCRYPTION_KEY: 'ZGV2ZWxvcG1lbnQtb25seS1lbmNyeXB0aW9uLWtleSE=',
      SMS_PROVIDER: 'mailpit',
      // Its own bucket on the compose.yaml storage service, or CI's.
      ...testStorageEnv('web'),
    },
  },
})
