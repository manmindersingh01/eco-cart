import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

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

test('RR01 approved return refund records, exact money and stale recovery', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  const data = z
    .object({
      orderProducts: z.record(
        z.string(),
        z.object({ gatewayReturnId: z.string(), bankReturnId: z.string() }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).orderProducts[
    info.project.name
  ]!
  await signIn(page)
  expect(
    (
      await page.request.post(
        `/api/admin/returns/${data.gatewayReturnId}/refund`,
        {
          data: {
            method: 'gateway',
            amountPaise: 12345,
            razorpayRefundId: 'rfnd_FP8QHiV938haTz',
          },
        },
      )
    ).status(),
  ).toBe(403)
  await page.context().clearCookies()
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  await page.goto(`/admin/returns/${data.gatewayReturnId}`)
  await expect(
    page.getByRole('heading', { name: 'Record an already-made refund' }),
  ).toBeVisible()
  await expect(page.getByLabel('Refund amount (₹)')).toHaveValue('123.45')
  await page.getByLabel('Refund amount (₹)').fill('123.46')
  await expect(
    page.getByRole('button', { name: 'Record return refund', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByText('Enter no more than ₹123.45.', { exact: true }),
  ).toBeVisible()
  expect(
    (
      await page.request.post(
        `/api/admin/returns/${data.gatewayReturnId}/refund`,
        {
          data: {
            method: 'gateway',
            amountPaise: 12346,
            razorpayRefundId: 'rfnd_FP8QHiV938haTz',
          },
        },
      )
    ).status(),
  ).toBe(409)
  await page.getByLabel('Refund amount (₹)').fill('1.001')
  await expect(
    page.getByRole('button', { name: 'Record return refund', exact: true }),
  ).toBeDisabled()
  await page.getByLabel('Refund amount (₹)').fill('123.45')
  await page.getByLabel('Refund method').selectOption('bank_transfer')
  await expect(page.getByLabel('Bank transfer reference')).toBeVisible()
  await expect(page.getByLabel('Razorpay refund ID')).toHaveCount(0)
  await page.getByLabel('Refund method').selectOption('gateway')
  const ref = `rfnd_${'R'.repeat(13)}${info.project.name === 'chrome-phone' ? 'P' : info.project.name === 'chrome-medium' ? 'M' : 'D'}`
  await page.getByLabel('Razorpay refund ID').fill(ref)
  const stale = await page.context().newPage()
  await stale.goto(`/admin/returns/${data.gatewayReturnId}`)
  await stale.getByLabel('Razorpay refund ID').fill(ref)
  await page.emulateMedia({ colorScheme: 'dark' })
  await checkLayout(page)
  await page
    .getByRole('button', { name: 'Record return refund', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('No money is moved')
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('return-refund-confirm-dark.png'),
  })
  const saved = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/admin/returns/${data.gatewayReturnId}/refund`) &&
      response.request().method() === 'POST',
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm refund record' })
    .click()
  const response = await saved
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({
    method: 'gateway',
    amountPaise: 12345,
    razorpayRefundId: ref,
  })
  await expect(
    page.getByText('Recorded amount: ₹123.45', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Method: Razorpay', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Record return refund', exact: true }),
  ).toHaveCount(0)
  await stale
    .getByRole('button', { name: 'Record return refund', exact: true })
    .click()
  const conflict = stale.waitForResponse(
    (result) =>
      result
        .url()
        .endsWith(`/api/admin/returns/${data.gatewayReturnId}/refund`) &&
      result.request().method() === 'POST',
  )
  await stale
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm refund record' })
    .click()
  expect((await conflict).status()).toBe(409)
  await expect(
    stale.getByRole('alert').filter({ hasText: 'already refunded' }),
  ).toBeVisible()
  await expect(
    stale.getByRole('button', { name: 'Record return refund', exact: true }),
  ).toHaveCount(0)
  await stale.close()
  await page.goto(`/admin/returns/${data.bankReturnId}`)
  await expect(
    page.getByText('Cash on delivery: record a bank transfer.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByLabel('Refund method')).toHaveCount(0)
  await expect(page.getByLabel('Razorpay refund ID')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Record return refund', exact: true }),
  ).toBeDisabled()
  await page.getByLabel('Bank transfer reference').fill('BANK-TEST-12345')
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('return-refund-bank-dark.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('return-refund-bank-light.png'),
    fullPage: true,
  })
  const routePattern = `**/api/admin/returns/${data.bankReturnId}/refund`
  await page.route(routePattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Refund recording is unavailable. Try again.',
      }),
    }),
  )
  await page
    .getByRole('button', { name: 'Record return refund', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm refund record' })
    .click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Refund recording is unavailable' }),
  ).toBeVisible()
  await expect(page.getByLabel('Bank transfer reference')).toHaveValue(
    'BANK-TEST-12345',
  )
  await page.unroute(routePattern)
  await page
    .getByRole('button', { name: 'Record return refund', exact: true })
    .click()
  const bankSaved = page.waitForResponse(
    (result) =>
      result.url().endsWith(`/api/admin/returns/${data.bankReturnId}/refund`) &&
      result.request().method() === 'POST',
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm refund record' })
    .click()
  const bankResponse = await bankSaved
  expect(bankResponse.status()).toBe(200)
  expect(bankResponse.request().postDataJSON()).toEqual({
    method: 'bank_transfer',
    amountPaise: 12345,
    note: 'BANK-TEST-12345',
  })
  await expect(
    page.getByText('Recorded amount: ₹123.45', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Method: Bank transfer', { exact: true }),
  ).toBeVisible()
  const sellerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: page.viewportSize(),
    extraHTTPHeaders: headers(),
  })
  try {
    const seller = await sellerContext.newPage()
    await signIn(seller, fixturesFor(info.project.name).sellerEmail)
    const ledger = z
      .object({
        items: z.array(
          z.object({
            returnRequestId: z.string().nullable(),
            entryType: z.string(),
            amountPaise: z.number(),
          }),
        ),
      })
      .parse(await (await seller.request.get('/api/seller/ledger')).json())
    for (const returnId of [data.gatewayReturnId, data.bankReturnId]) {
      const entries = ledger.items.filter(
        (entry) => entry.returnRequestId === returnId,
      )
      expect(entries.map((entry) => entry.entryType)).toEqual(
        expect.arrayContaining(['refund_reversal', 'commission_reversal']),
      )
      expect(
        entries.find((entry) => entry.entryType === 'refund_reversal')
          ?.amountPaise,
      ).toBe(-12345)
    }
  } finally {
    await sellerContext.close()
  }
})
