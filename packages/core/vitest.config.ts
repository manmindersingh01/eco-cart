import { configDefaults, defineConfig } from 'vitest/config'
import {
  testDatabase,
  testStorageEnv,
  type TestDatabase,
} from './src/testing/urls.ts'

/*
 * Two projects with a database each. The settings tests empty
 * platform_settings before every test, while the cart and checkout tests
 * need a saved delivery charge; in one database the two would break each
 * other at random, because test files run at the same time.
 */
const SETTINGS_TESTS = 'src/modules/settings/**/*.test.ts'

const environment = (database: TestDatabase) => ({
  DATABASE_URL: database.webUrl,
  WORKER_DATABASE_URL: database.workerUrl,
  MIGRATION_DATABASE_URL: database.migrationUrl,
  // The Mailpit catcher from compose.yaml, or CI's service container.
  MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:8025',
  // ecokart-test-core on the compose.yaml storage service, or CI's.
  ...testStorageEnv('core'),
})

export default defineConfig({
  test: {
    // These tests talk to a real PostgreSQL, Mailpit, and object storage.
    // On a busy laptop or a small CI runner a few take several seconds, so
    // Vitest's 5-second default made them fail at random; a real hang still
    // fails at 20 seconds.
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          exclude: [...configDefaults.exclude, SETTINGS_TESTS],
          // Rebuilds ecokart_test_core from the real migrations and empties
          // the test bucket before every run.
          globalSetup: ['./vitest.global-setup.ts'],
          env: environment(testDatabase('core')),
        },
      },
      {
        extends: true,
        test: {
          name: 'settings',
          include: [SETTINGS_TESTS],
          // Rebuilds ecokart_test_core_settings the same way.
          globalSetup: ['./vitest.settings-setup.ts'],
          env: environment(testDatabase('core_settings')),
        },
      },
    ],
  },
})
