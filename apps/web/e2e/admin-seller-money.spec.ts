import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
const inr = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    paise / 100,
  )
const balancePage = z.object({
  items: z.array(z.object({ sellerId: z.string(), balancePaise: z.number() })),
  nextCursor: z.string().nullable(),
})
const ledgerPage = z.object({
  items: z.array(z.object({ id: z.number(), description: z.string() })),
  balancePaise: z.number(),
})
async function layout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await expect
    .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
    .toEqual([])
}

test('AM01 admin balances, bank entry/replacement and ledger permissions', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  const fixture = z
    .object({
      adminMoney: z.record(
        z.string(),
        z.object({
          sellerId: z.string(),
          sellerEmail: z.string(),
          ledgerSellerId: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).adminMoney[
    info.project.name
  ]!
  const sellerPath = `/admin/sellers/${fixture.sellerId}`
  const bankPath = `/api/admin/sellers/${fixture.sellerId}/bank-account`
  await page.goto('/admin/payouts')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page)
  await page.goto('/admin/payouts')
  await expect(page).toHaveURL(/\/access-denied/)
  expect((await page.request.get('/api/admin/seller-balances')).status()).toBe(
    403,
  )
  await page.context().clearCookies()
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  await page.goto('/admin/payouts')
  const first = balancePage.parse(
    await (
      await page.request.get('/api/admin/seller-balances?limit=20')
    ).json(),
  )
  const list = page.getByRole('region', {
    name: 'Seller balances',
    exact: true,
  })
  await expect(list.locator('li')).toHaveCount(20)
  expect(
    await list
      .locator('li')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-seller-id')),
      ),
  ).toEqual(first.items.map((row) => row.sellerId))
  expect(
    first.items.every(
      (row, index) =>
        row.balancePaise !== 0 &&
        (!index || first.items[index - 1]!.balancePaise >= row.balancePaise),
    ),
  ).toBe(true)
  await layout(page)
  await page.screenshot({
    path: info.outputPath('balances-light.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: 'More balances', exact: true }).click()
  await expect(page).toHaveURL(/cursor=/)
  const second = balancePage.parse(
    await (
      await page.request.get(
        `/api/admin/seller-balances?limit=20&cursor=${encodeURIComponent(first.nextCursor!)}`,
      )
    ).json(),
  )
  expect(
    await list
      .locator('li')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-seller-id')),
      ),
  ).toEqual(second.items.map((row) => row.sellerId))
  expect(
    second.items.some((row) =>
      first.items.some((old) => old.sellerId === row.sellerId),
    ),
  ).toBe(false)
  expect(second.items.some((row) => row.balancePaise < 0)).toBe(true)
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await page.screenshot({
    path: info.outputPath('balances-dark.png'),
    fullPage: true,
  })
  await page.goto(sellerPath)
  const money = page.getByRole('region', { name: 'Seller money', exact: true })
  await expect(
    money.getByText('No bank account yet.', { exact: false }),
  ).toBeVisible()
  const holder = page.getByRole('textbox', {
    name: 'Account holder',
    exact: true,
  })
  const number = page.locator('#bank-number')
  const ifsc = page.getByRole('textbox', { name: 'Bank IFSC', exact: true })
  await expect(holder).toBeEmpty()
  await expect(number).toBeEmpty()
  await expect(ifsc).toBeEmpty()
  await expect(number).toHaveAttribute('type', 'password')
  await holder.fill('Bank Test Holder')
  await number.fill('987654321234')
  await ifsc.fill('INVALID')
  await page
    .getByRole('button', { name: 'Review bank details', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save bank account', exact: true })
    .click()
  await expect(
    money
      .getByRole('alert')
      .filter({ hasText: 'Those bank details are not valid' }),
  ).toBeVisible()
  await expect(number).toBeEmpty()
  await number.fill('987654321234')
  await ifsc.fill('hdfc0001234')
  await page
    .getByRole('button', { name: 'Review bank details', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('ending 1234')
  await expect(dialog).not.toContainText('987654321234')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Review bank details', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await dialog
    .getByRole('button', { name: 'Save bank account', exact: true })
    .click()
  await expect(money.getByText('•••• 1234', { exact: true })).toBeVisible()
  for (const input of [holder, number, ifsc]) await expect(input).toBeEmpty()
  expect(await (await page.request.get(bankPath)).text()).not.toContain(
    '987654321234',
  )
  expect(await page.content()).not.toContain('987654321234')
  await expect(
    money.getByRole('heading', { name: 'Replace bank account', exact: true }),
  ).toBeVisible()
  await holder.fill('Replacement Holder')
  await number.fill('987654325678')
  await ifsc.fill('HDFC0001234')
  await page
    .getByRole('button', { name: 'Review bank details', exact: true })
    .click()
  await expect(dialog).toContainText('Replace the account ending 1234')
  await dialog
    .getByRole('button', { name: 'Save bank account', exact: true })
    .click()
  await expect(money.getByText('•••• 5678', { exact: true })).toBeVisible()
  for (const input of [holder, number, ifsc]) await expect(input).toBeEmpty()
  await page.reload()
  for (const input of [holder, number, ifsc]) await expect(input).toBeEmpty()
  await money.scrollIntoViewIfNeeded()
  await layout(page)
  await money.screenshot({
    path: info.outputPath('seller-money-dark.png'),
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await layout(page)
  await money.screenshot({
    path: info.outputPath('seller-money-light.png'),
  })
  const sellerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: headers(),
  })
  try {
    const seller = await sellerContext.newPage()
    await signIn(seller, fixture.sellerEmail)
    expect(
      (await seller.request.get('/api/admin/seller-balances')).status(),
    ).toBe(403)
    expect((await seller.request.get(bankPath)).status()).toBe(403)
    expect(
      (
        await seller.request.put(bankPath, {
          data: {
            accountHolder: 'Denied',
            accountNumber: '987654321234',
            ifsc: 'HDFC0001234',
          },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await seller.request.get(
          `/api/admin/sellers/${fixture.sellerId}/ledger`,
        )
      ).status(),
    ).toBe(403)
    const ownBank = await (
      await seller.request.get('/api/seller/bank-account')
    ).text()
    expect(ownBank).toContain('5678')
    expect(ownBank).not.toContain('987654325678')
    await seller.goto(sellerPath)
    await expect(seller).toHaveURL(/\/access-denied/)
  } finally {
    await sellerContext.close()
  }
  const ledgerPath = `/admin/sellers/${fixture.ledgerSellerId}`
  await page.goto(ledgerPath)
  const current = ledgerPage.parse(
    await (
      await page.request.get(
        `/api/admin/sellers/${fixture.ledgerSellerId}/ledger?limit=20`,
      )
    ).json(),
  )
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    inr(current.balancePaise),
  )
  const history = page.getByRole('region', {
    name: 'Money history',
    exact: true,
  })
  await expect(history.locator('li')).toHaveCount(20)
  await page
    .getByRole('link', { name: 'Older money entries', exact: true })
    .click()
  await expect(page).toHaveURL(/ledgerCursor=/)
  const cursor = new URL(page.url()).searchParams.get('ledgerCursor')!
  const older = ledgerPage.parse(
    await (
      await page.request.get(
        `/api/admin/sellers/${fixture.ledgerSellerId}/ledger?limit=20&cursor=${encodeURIComponent(cursor)}`,
      )
    ).json(),
  )
  for (const entry of older.items)
    await expect(
      history.getByText(entry.description, { exact: true }),
    ).toBeVisible()
  expect(
    older.items.some((row) => current.items.some((old) => old.id === row.id)),
  ).toBe(false)
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    inr(current.balancePaise),
  )
  await page.goto(`${ledgerPath}?ledgerCursor=invalid`)
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This page of money history could not be shown' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Show latest money entries', exact: true })
    .click()
  await expect(
    page.getByLabel('Current balance', { exact: true }),
  ).toBeVisible()
  await page.goto('/admin/payouts?cursor=invalid')
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This page of balances could not be shown' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Show first balances', exact: true })
    .click()
  await expect(list.locator('li')).toHaveCount(20)
})
