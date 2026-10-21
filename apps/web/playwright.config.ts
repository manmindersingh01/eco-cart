import { defineConfig } from '@playwright/test'

const browsers =
  process.env.E2E_CHROME === '1'
    ? (['chrome'] as const)
    : (['chromium', 'firefox', 'webkit'] as const)

export default defineConfig({
  testDir: './e2e',
  testMatch:
    process.env.E2E_PROBE === 'assertion'
      ? '**/assertion.probe.ts'
      : '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: process.env.E2E_RESULTS_DIR ?? 'test-results',
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: process.env.E2E_REPORT_DIR ?? 'playwright-report',
        open: 'never',
      },
    ],
    [
      'junit',
      {
        outputFile: `${process.env.E2E_RESULTS_DIR ?? 'test-results'}/junit.xml`,
      },
    ],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3211',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: browsers.flatMap((browser) =>
    ['desktop', 'phone'].map((size) => ({
      name: `${browser}-${size}`,
      use: {
        browserName: browser === 'chrome' ? ('chromium' as const) : browser,
        ...(browser === 'chrome' ? { channel: 'chrome' } : {}),
        viewport:
          size === 'desktop'
            ? { width: 1440, height: 900 }
            : { width: 390, height: 844 },
      },
    })),
  ),
})
