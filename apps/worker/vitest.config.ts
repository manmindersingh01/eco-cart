import { testDatabase } from '@ecokart/core/testing'
import { defineConfig } from 'vitest/config'

const database = testDatabase('worker')

export default defineConfig({
  test: {
    // Rebuilds ecokart_test_worker from the real migrations before every run.
    globalSetup: ['./vitest.global-setup.ts'],
    env: {
      DATABASE_URL: database.workerUrl,
      // Only for the test that sends a job the way the web app will.
      WEB_DATABASE_URL: database.webUrl,
    },
  },
})
