import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
const ledgerSchema = z.object({
  sellerId: z.string(),
  balancePaise: z.number(),
  items: z.array(
    z.object({
      id: z.number(),
      description: z.string(),
      amountPaise: z.number(),
    }),
  ),
})
const inr = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    paise / 100,
  )
async function checkLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await expect
    .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
    .toEqual([])
}

test('SE01 seller earnings signs, pagination, masking and isolation', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  const data = z
    .object({
      orderProducts: z.record(
        z.string(),
        z.object({ sellerEmail: z.string(), otherSellerEmail: z.string() }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).orderProducts[
    info.project.name
  ]!
  await page.goto('/seller/earnings')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page)
  await page.goto('/seller/earnings')
  await expect(page).toHaveURL(/\/access-denied/)
  await page.context().clearCookies()
  await signIn(page, data.sellerEmail)
  await page.goto('/seller/earnings')
  await expect(
    page.getByRole('heading', { name: 'Earnings', exact: true }),
  ).toBeVisible()
  const initial = ledgerSchema.parse(
    await (await page.request.get('/api/seller/ledger?limit=20')).json(),
  )
  expect(initial.balancePaise).toBe(-123456789)
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    '-₹12,34,567.89',
  )
  await expect(
    page.getByText('You owe EcoKart.', { exact: false }),
  ).toBeVisible()
  const history = page.getByRole('region', { name: 'Money history' })
  await expect(history.locator('li')).toHaveCount(20)
  for (const item of initial.items)
    await expect(
      history.getByText(item.description, { exact: true }),
    ).toBeVisible()
  await expect(
    history.getByText('+₹1.00', { exact: true }).first(),
  ).toBeVisible()
  await expect(
    history.getByText('-₹1.00', { exact: true }).first(),
  ).toBeVisible()
  await expect(page.getByText('•••• 4321', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Earnings Test Seller', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('HDFC0001234', { exact: true })).toBeVisible()
  expect(await page.content()).not.toContain('123456784321')
  const bank = await (await page.request.get('/api/seller/bank-account')).text()
  expect(bank).not.toContain('123456784321')
  await expect(
    page
      .getByRole('heading', { name: 'Bank account for payouts' })
      .locator('..')
      .locator('input, textarea, select'),
  ).toHaveCount(0)
  expect(
    (
      await page.request.put('/api/seller/bank-account', {
        data: {
          accountHolder: 'Changed',
          accountNumber: '999999999999',
          ifsc: 'HDFC0001234',
        },
      })
    ).status(),
  ).toBe(405)
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('seller-earnings-light.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('seller-earnings-dark.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: 'Older entries', exact: true }).click()
  await expect(page).toHaveURL(/cursor=/)
  const cursor = new URL(page.url()).searchParams.get('cursor')!
  const older = ledgerSchema.parse(
    await (
      await page.request.get(
        `/api/seller/ledger?${new URLSearchParams({ cursor, limit: '20' })}`,
      )
    ).json(),
  )
  await expect(history.locator('li')).toHaveCount(older.items.length)
  for (const item of older.items)
    await expect(
      history.getByText(item.description, { exact: true }),
    ).toBeVisible()
  expect(
    older.items.some((item) =>
      initial.items.some((first) => first.id === item.id),
    ),
  ).toBe(false)
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    inr(initial.balancePaise),
  )
  await page
    .getByRole('link', { name: 'Show the latest entries', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/seller\/earnings$/)
  const otherContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: page.viewportSize(),
    extraHTTPHeaders: headers(),
  })
  try {
    const other = await otherContext.newPage()
    await signIn(other, data.otherSellerEmail)
    await other.goto('/seller/earnings')
    await expect(
      other.getByLabel('Current balance', { exact: true }),
    ).toHaveText('₹0.00')
    await expect(
      other.getByRole('heading', { name: 'No money entries yet' }),
    ).toBeVisible()
    await expect(
      other.getByText('No bank account has been added yet.', { exact: true }),
    ).toBeVisible()
    await expect(
      other.getByText('Earnings Test Seller', { exact: true }),
    ).toHaveCount(0)
    await checkLayout(other)
    await otherContext.clearCookies()
    await signIn(other, fixturesFor(info.project.name).sellerEmail)
    await other.goto('/seller/earnings')
    const positive = ledgerSchema.parse(
      await (await other.request.get('/api/seller/ledger')).json(),
    )
    expect(positive.balancePaise).toBeGreaterThan(0)
    await expect(
      other.getByLabel('Current balance', { exact: true }),
    ).toHaveText(inr(positive.balancePaise))
    await expect(
      other.getByText('EcoKart owes you this amount.', { exact: true }),
    ).toBeVisible()
    await otherContext.clearCookies()
    await signIn(other, fixturesFor(info.project.name).adminEmail)
    const adjusted = await other.request.post(
      `/api/admin/sellers/${initial.sellerId}/adjustments`,
      { data: { amountPaise: 25, reason: 'Earnings refresh check' } },
    )
    expect(adjusted.status()).toBe(201)
    await page
      .getByRole('button', { name: 'Refresh earnings', exact: true })
      .focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByLabel('Current balance', { exact: true }),
    ).toHaveText(inr(initial.balancePaise + 25))
    await expect(
      history.getByText('Earnings refresh check', { exact: false }),
    ).toBeVisible()
  } finally {
    await otherContext.close()
  }
  await page.goto('/seller/earnings?cursor=invalid')
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This page of earnings could not be shown' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Show the latest entries', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Current balance', exact: true }),
  ).toBeVisible()
})
