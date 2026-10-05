import { fileURLToPath } from 'node:url'
import { testDatabase } from '@ecokart/core/testing'
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
    },
  },
})
