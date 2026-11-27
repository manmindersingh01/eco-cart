import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
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
const statementSchema = z.object({
  id: z.string(),
  status: z.string(),
  closingBalancePaise: z.number().nullable(),
})

test('SD01 seller statements, polling and private invoice files', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
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
  await page.goto('/seller/invoices')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page)
  await page.goto('/seller/invoices')
  await expect(page).toHaveURL(/\/access-denied/)
  await page.context().clearCookies()
  await signIn(page, data.sellerEmail)
  const seeded = z
    .object({ items: z.array(statementSchema) })
    .parse(
      await (
        await page.request.get('/api/seller/settlement-statements')
      ).json(),
    ).items
  const processing = seeded.find((item) => item.status === 'processing')!
  const failed = seeded.find((item) => item.status === 'failed')!
  const statusHref = `/api/settlement-statements/${processing.id}?as=seller`
  await page.route(statusHref, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'The statement status is temporarily unavailable.',
      }),
    }),
  )
  await page.goto('/seller/earnings')
  const processingCard = page.locator(`[data-statement-id="${processing.id}"]`)
  await expect(
    page.locator(`[data-statement-id="${failed.id}"]`).getByRole('alert'),
  ).toContainText('The test statement file could not be written.')
  await expect(
    processingCard.getByRole('link', { name: 'Download CSV', exact: true }),
  ).toHaveCount(0)
  await expect(processingCard.getByRole('alert')).toContainText(
    'temporarily unavailable',
  )
  await page.unroute(statusHref)
  await processingCard
    .getByRole('button', { name: 'Retry status check' })
    .click()
  const checked = await page.waitForResponse(
    (response) =>
      response.url().endsWith(statusHref) && response.status() === 200,
  )
  expect(checked.status()).toBe(200)
  await page.getByRole('link', { name: 'Invoices', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Invoices', exact: true }),
  ).toBeVisible()
  await expect(
    page.waitForRequest((request) => request.url().endsWith(statusHref), {
      timeout: 3000,
    }),
  ).rejects.toThrow(/Timeout/)
  await expect
    .poll(
      async () =>
        z
          .object({ items: z.array(z.object({ pdfReady: z.boolean() })) })
          .parse(await (await page.request.get('/api/seller/invoices')).json())
          .items.some((item) => item.pdfReady),
      { timeout: 60000 },
    )
    .toBe(true)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Invoices', exact: true }),
  ).toBeVisible()
  const invoices = z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          pdfReady: z.boolean(),
          invoiceNumber: z.string(),
        }),
      ),
    })
    .parse(await (await page.request.get('/api/seller/invoices')).json()).items
  await expect(page.locator('[data-invoice-id]')).toHaveCount(invoices.length)
  const readyInvoice = invoices.find((item) => item.pdfReady)!
  const waitingInvoice = invoices.find((item) => !item.pdfReady)!
  await expect(
    page
      .locator(`[data-invoice-id="${waitingInvoice.id}"]`)
      .getByText('Invoice PDF is not ready', { exact: true }),
  ).toBeVisible()
  const readyCard = page.locator(`[data-invoice-id="${readyInvoice.id}"]`)
  const pdfHref = await readyCard
    .getByRole('link', { name: 'Download PDF', exact: true })
    .getAttribute('href')
  expect(pdfHref).toMatch(/\?as=seller$/)
  expect((await page.request.get(pdfHref!, { maxRedirects: 0 })).status()).toBe(
    302,
  )
  expect(
    (
      await page.request.get(pdfHref!.replace('?as=seller', ''), {
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(404)
  await page.route(pdfHref!, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'The invoice PDF is still being made; try again in a minute',
      }),
    }),
  )
  await readyCard
    .getByRole('link', { name: 'Download PDF', exact: true })
    .click()
  await expect(readyCard.getByRole('alert')).toContainText('still being made')
  await page.unroute(pdfHref!)
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('seller-invoices-light.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('seller-invoices-dark.png'),
    fullPage: true,
  })
  const pdfDownload = page.waitForEvent('download')
  await readyCard
    .getByRole('link', { name: 'Download PDF', exact: true })
    .click()
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/)
  await page.goto('/seller/invoices?cursor=invalid')
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This page of invoices could not be shown' }),
  ).toBeVisible()
  await page.goto('/seller/earnings')
  await page.getByLabel('Start date').fill('2026-10-02')
  await page.getByLabel('End date').fill('2026-10-01')
  await page
    .getByRole('button', { name: 'Request statement', exact: true })
    .click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Statement could not be requested' }),
  ).toContainText('start date must not be after the end date')
  await expect(page.getByLabel('Start date')).toHaveValue('2026-10-02')
  await page.getByLabel('Start date').fill('2025-01-01')
  await page.getByLabel('End date').fill('2026-11-01')
  await page
    .getByRole('button', { name: 'Request statement', exact: true })
    .click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Statement could not be requested' }),
  ).toContainText('366 days')
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  await page.getByLabel('Start date').fill(`${today.slice(0, 8)}01`)
  await page.getByLabel('End date').fill(today)
  const requested = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/seller/settlement-statements') &&
      response.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Request statement', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  const created = await requested
  expect(created.status()).toBe(202)
  const statement = z
    .object({ statement: statementSchema })
    .parse(await created.json()).statement
  const card = page.locator(`[data-statement-id="${statement.id}"]`)
  await expect(
    card.getByRole('link', { name: 'Download CSV', exact: true }),
  ).toBeVisible({ timeout: 60000 })
  const finished = z
    .object({ statement: statementSchema })
    .parse(
      await (
        await page.request.get(
          `/api/settlement-statements/${statement.id}?as=seller`,
        )
      ).json(),
    ).statement
  expect(finished.status).toBe('ready')
  expect(finished.closingBalancePaise).toBeLessThan(0)
  await expect(
    card.getByText(
      new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(finished.closingBalancePaise! / 100),
      { exact: true },
    ),
  ).toBeVisible()
  const csvHref = await card
    .getByRole('link', { name: 'Download CSV', exact: true })
    .getAttribute('href')
  expect(csvHref).toMatch(/\?as=seller$/)
  expect((await page.request.get(csvHref!, { maxRedirects: 0 })).status()).toBe(
    302,
  )
  expect(
    (
      await page.request.get(csvHref!.replace('?as=seller', ''), {
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(404)
  await checkLayout(page)
  await page
    .getByRole('region', { name: 'Settlement statements' })
    .screenshot({ path: info.outputPath('seller-statements-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  await checkLayout(page)
  await page
    .getByRole('region', { name: 'Settlement statements' })
    .screenshot({ path: info.outputPath('seller-statements-light.png') })
  const csvDownload = page.waitForEvent('download')
  await card.getByRole('link', { name: 'Download CSV', exact: true }).click()
  expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/)
  const otherContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: page.viewportSize(),
    extraHTTPHeaders: headers(),
  })
  try {
    const other = await otherContext.newPage()
    await signIn(other, data.otherSellerEmail)
    expect(
      (await other.request.get(csvHref!, { maxRedirects: 0 })).status(),
    ).toBe(404)
    expect(
      (
        await other.request.get(
          `/api/settlement-statements/${statement.id}?as=seller`,
        )
      ).status(),
    ).toBe(404)
    expect(
      (await other.request.get(pdfHref!, { maxRedirects: 0 })).status(),
    ).toBe(404)
    await other.goto('/seller/invoices')
    await expect(
      other.getByRole('heading', { name: 'No invoices yet' }),
    ).toBeVisible()
  } finally {
    await otherContext.close()
  }
  await page.goto('/seller/earnings?statementCursor=invalid')
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Statement history could not be shown' }),
  ).toBeVisible()
})
