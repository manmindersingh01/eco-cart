import { defineConfig } from 'vitest/config'
import { testDatabase } from './src/testing/urls.ts'

const database = testDatabase('core')

export default defineConfig({
  test: {
    // Rebuilds ecokart_test_core from the real migrations before every run.
    globalSetup: ['./vitest.global-setup.ts'],
    env: {
      DATABASE_URL: database.webUrl,
      WORKER_DATABASE_URL: database.workerUrl,
      MIGRATION_DATABASE_URL: database.migrationUrl,
    },
  },
})
