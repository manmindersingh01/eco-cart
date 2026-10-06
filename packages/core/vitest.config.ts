import { defineConfig } from 'vitest/config'
import { testDatabase, testStorageEnv } from './src/testing/urls.ts'

const database = testDatabase('core')

export default defineConfig({
  test: {
    // Rebuilds ecokart_test_core from the real migrations before every run.
    globalSetup: ['./vitest.global-setup.ts'],
    env: {
      DATABASE_URL: database.webUrl,
      WORKER_DATABASE_URL: database.workerUrl,
      MIGRATION_DATABASE_URL: database.migrationUrl,
      // The Mailpit catcher from compose.yaml, or CI's service container.
      MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:8025',
      // ecokart-test-core on the compose.yaml storage service, or CI's.
      ...testStorageEnv('core'),
    },
  },
})
