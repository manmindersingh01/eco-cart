import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
const statement = z.object({
  id: z.string(),
  status: z.string(),
  closingBalancePaise: z.number().nullable(),
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

test('AS01 admin statement history, worker file, private access and polling lifecycle', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  const fixture = z
    .object({
      adminMoney: z.record(
        z.string(),
        z.object({ sellerId: z.string(), ledgerSellerId: z.string() }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).adminMoney[
    info.project.name
  ]!
  await page.goto(`/admin/sellers/${fixture.sellerId}`)
  await expect(
    page.getByRole('heading', { name: 'No statements yet', exact: true }),
  ).toBeVisible()
  const sellerPath = `/admin/sellers/${fixture.ledgerSellerId}`
  const api = `/api/admin/sellers/${fixture.ledgerSellerId}/settlement-statements`
  const seeded = z
    .object({ items: z.array(statement) })
    .parse(await (await page.request.get(api)).json()).items
  const processing = seeded.find((item) => item.status === 'processing')!
  const failed = seeded.find((item) => item.status === 'failed')!
  const statusPath = `/api/settlement-statements/${processing.id}`
  await page.route(statusPath, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Statement status temporarily unavailable.',
      }),
    }),
  )
  await page.goto(sellerPath)
  const pendingCard = page.locator(`[data-statement-id="${processing.id}"]`)
  await expect(
    page.locator(`[data-statement-id="${failed.id}"]`).getByRole('alert'),
  ).toContainText('The test statement file could not be written.')
  await expect(
    pendingCard.getByRole('link', { name: 'Download CSV', exact: true }),
  ).toHaveCount(0)
  await expect(pendingCard.getByRole('alert')).toContainText(
    'temporarily unavailable',
  )
  await page.unroute(statusPath)
  const retried = page.waitForResponse(
    (response) =>
      response.url().endsWith(statusPath) && response.status() === 200,
  )
  await pendingCard.getByRole('button', { name: 'Retry status check' }).click()
  await retried
  await page
    .getByRole('link', { name: 'Back to balances', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Seller balances', exact: true }),
  ).toBeVisible()
  await expect(
    page.waitForRequest((request) => request.url().endsWith(statusPath), {
      timeout: 3000,
    }),
  ).rejects.toThrow(/Timeout/)
  const firstStatement = z
    .object({ nextCursor: z.string() })
    .parse(await (await page.request.get(`${api}?limit=1`)).json())
  const firstLedger = z
    .object({ nextCursor: z.string() })
    .parse(
      await (
        await page.request.get(
          `/api/admin/sellers/${fixture.ledgerSellerId}/ledger?limit=20`,
        )
      ).json(),
    )
  await page.goto(
    `${sellerPath}?${new URLSearchParams({ statementCursor: firstStatement.nextCursor, ledgerCursor: firstLedger.nextCursor })}`,
  )
  await page
    .getByRole('link', { name: 'Show latest money entries', exact: true })
    .click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.has('statementCursor') &&
      !url.searchParams.has('ledgerCursor'),
  )
  const section = page.getByRole('region', {
    name: 'Settlement statements',
    exact: true,
  })
  const from = section.locator('#statement-from')
  const to = section.locator('#statement-to')
  await from.fill('2026-02-02')
  await to.fill('2026-02-01')
  await section
    .getByRole('button', { name: 'Request statement', exact: true })
    .click()
  await expect(
    section
      .getByRole('alert')
      .filter({ hasText: 'Statement could not be requested' }),
  ).toContainText('start date must not be after')
  await expect(from).toHaveValue('2026-02-02')
  await expect(to).toHaveValue('2026-02-01')
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  await from.fill(`${today.slice(0, 8)}01`)
  await to.fill(today)
  const requested = page.waitForResponse(
    (response) =>
      response.url().endsWith(api) && response.request().method() === 'POST',
  )
  await section
    .getByRole('button', { name: 'Request statement', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  const response = await requested
  expect(response.status()).toBe(202)
  const created = z.object({ statement }).parse(await response.json()).statement
  const card = page.locator(`[data-statement-id="${created.id}"]`)
  const download = card.getByRole('link', { name: 'Download CSV', exact: true })
  await expect(download).toBeVisible({ timeout: 60000 })
  const ready = z
    .object({ statement })
    .parse(
      await (
        await page.request.get(`/api/settlement-statements/${created.id}`)
      ).json(),
    ).statement
  expect(ready.status).toBe('ready')
  expect(ready.closingBalancePaise).toBeLessThan(0)
  const filePath = `/api/settlement-statements/${created.id}/file`
  await expect(download).toHaveAttribute('href', filePath)
  const redirect = await page.request.get(filePath, { maxRedirects: 0 })
  expect(redirect.status()).toBe(302)
  expect(redirect.headers()['cache-control']).toBe('no-store')
  expect(await page.content()).not.toContain('X-Amz-Signature')
  await page.route(filePath, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'The statement file is temporarily unavailable.',
      }),
    }),
  )
  await download.click()
  await expect(card.getByRole('alert')).toContainText('temporarily unavailable')
  await page.unroute(filePath)
  const file = page.waitForEvent('download')
  await download.click()
  const downloaded = await file
  expect(downloaded.suggestedFilename()).toMatch(/settlement-.*\.csv$/)
  const csv = await readFile(await downloaded.path(), 'utf8')
  expect(csv).toContain('Earnings fixture')
  expect(csv).not.toContain('123456784321')
  await layout(page)
  await section.screenshot({
    path: info.outputPath('admin-statements-light.png'),
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await section.screenshot({
    path: info.outputPath('admin-statements-dark.png'),
  })
  const otherContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: headers(),
  })
  try {
    const other = await otherContext.newPage()
    await signIn(other, fixturesFor(info.project.name).otherSellerEmail)
    expect((await other.request.get(api)).status()).toBe(403)
    expect(
      (
        await other.request.post(api, { data: { from: today, to: today } })
      ).status(),
    ).toBe(403)
    expect(
      (
        await other.request.get(
          `/api/settlement-statements/${created.id}?as=seller`,
        )
      ).status(),
    ).toBe(404)
    expect(
      (
        await other.request.get(`${filePath}?as=seller`, { maxRedirects: 0 })
      ).status(),
    ).toBe(404)
  } finally {
    await otherContext.close()
  }
  await page.goto(`${sellerPath}?statementCursor=invalid`)
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Statement history could not be shown' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Show latest statements', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: 'Settlement statements', exact: true }),
  ).toBeVisible()
})
