import { randomInt } from 'node:crypto'
import { AxeBuilder } from '@axe-core/playwright'
import { test as base, expect, type Page } from '@playwright/test'
import { z } from 'zod'

export const test = base.extend<{ checkPage: () => Promise<void> }>({
  checkPage: async ({ page, context }, use) => {
    const failures: string[] = []
    const consoleReads: Promise<void>[] = []
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
    })
    page.on('pageerror', (error) =>
      failures.push(`Page error: ${error.message}`),
    )
    page.on('console', (message) => {
      // Resource errors from these explicitly asserted refusals are expected.
      const location = message.location().url
      const expectedRefusal =
        (/Failed to load resource.*401/.test(message.text()) &&
          location.includes('/api/me')) ||
        (/Failed to load resource.*400/.test(message.text()) &&
          location.includes('/api/auth/sign-in/email-otp'))
      if (message.type() === 'error' && !expectedRefusal) {
        consoleReads.push(
          (async () => {
            const details = await Promise.all(
              message.args().map(async (argument) => {
                try {
                  return await argument.evaluate((value: unknown) =>
                    value instanceof Error
                      ? `${value.message}\n${value.stack}`
                      : String(value),
                  )
                } catch {
                  return 'Console argument unavailable after navigation'
                }
              }),
            )
            failures.push(
              `Console error: ${message.text()} ${details.join(' ')}`,
            )
          })(),
        )
      }
    })
    page.on('requestfailed', (request) => {
      if (
        !request.failure()?.errorText.includes('ERR_ABORTED') &&
        !request.failure()?.errorText.includes('NS_BINDING_ABORTED') &&
        !/cancelled|canceled/i.test(request.failure()?.errorText ?? '')
      ) {
        failures.push(
          `Failed request: ${request.method()} ${new URL(request.url()).pathname}`,
        )
      }
    })
    await use(async () => {
      await expect(page.locator('body')).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      const result = await new AxeBuilder({ page }).analyze()
      expect(
        result.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map((node) => node.target),
        })),
      ).toEqual([])
    })
    await Promise.all(consoleReads)
    expect(failures).toEqual([])
  },
})

export { expect }

export function fixturesFor(project: string) {
  const fixtures = z
    .object({
      categoryId: z.string(),
      accounts: z.record(
        z.string(),
        z.object({
          adminEmail: z.string(),
          sellerEmail: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}'))
  const account = fixtures.accounts?.[project]
  if (!account)
    throw new Error(
      'Run browsers through pnpm test:e2e to prepare isolated fixtures',
    )
  return { ...account, categoryId: fixtures.categoryId }
}

export async function expectProtectedRedirect(page: Page, path: string) {
  await page.goto(path)
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeEnabled()
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible()
}
