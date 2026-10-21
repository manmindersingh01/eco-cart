import { test, expect } from '@playwright/test'

test('P05 intentional harness assertion failure', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Deliberately impossible harness heading',
    { timeout: 1000 },
  )
})
