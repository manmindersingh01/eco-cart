import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
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

test('AP01 record completed payouts and signed corrections without repeating writes', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  const suffix = randomUUID().slice(0, 8)
  const email = `payout-${suffix}@ecokart.test`
  const created = await page.request.post('/api/admin/sellers', {
    data: {
      owner: { email, name: 'Payout test owner' },
      displayName: `Payout test ${suffix}`,
      legalName: 'Payout Test Limited',
      gstin: '27AAACE1234F1Z5',
      pan: 'AAACE1234F',
      line1: '1 Test Road',
      city: 'Pune',
      stateCode: '27',
      pincode: '411001',
      supportEmail: email,
      supportPhone: '+919800000000',
      invoicePrefix: `P${suffix.slice(0, 3).toUpperCase()}`,
    },
  })
  expect(created.status()).toBe(201)
  const id = z
    .object({ seller: z.object({ id: z.string() }) })
    .parse(await created.json()).seller.id
  expect(
    (await page.request.post(`/api/admin/sellers/${id}/approve`)).status(),
  ).toBe(200)
  const api = `/api/admin/sellers/${id}`
  await page.goto(`/admin/sellers/${id}`)
  const payout = page.getByRole('form', {
    name: 'Record an external payout',
    exact: true,
  })
  const adjustment = page.getByRole('form', {
    name: 'Record a balance adjustment',
    exact: true,
  })
  const amount = payout.locator('#payout-amount')
  const reference = payout.locator('#payout-reference')
  const changeAmount = adjustment.locator('#adjustment-amount')
  const reason = adjustment.locator('#adjustment-reason')
  const direction = adjustment.locator('#adjustment-direction')
  await expect(
    payout.getByText(
      'Add the seller’s bank account before recording a payout.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    payout.getByRole('button', { name: 'Review payout record' }),
  ).toBeDisabled()
  await changeAmount.fill('1.005')
  await expect(
    adjustment.getByText(
      'Amount must be a non-negative number with at most 2 decimal places.',
    ),
  ).toBeVisible()
  await expect(
    adjustment.getByRole('button', { name: 'Review adjustment' }),
  ).toBeDisabled()
  await changeAmount.fill('10.25')
  await expect(
    adjustment.getByRole('button', { name: 'Review adjustment' }),
  ).toBeDisabled()
  await reason.fill('Opening correction for payout verification')
  await adjustment.getByRole('button', { name: 'Review adjustment' }).focus()
  await page.keyboard.press('Enter')
  let dialog = page.getByRole('dialog', {
    name: 'Record this balance adjustment?',
  })
  await expect(dialog).toContainText('+₹10.25')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(
    adjustment.getByRole('button', { name: 'Review adjustment' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await dialog
    .getByRole('button', { name: 'Record adjustment', exact: true })
    .click()
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    '₹10.25',
  )
  await expect(changeAmount).toBeEmpty()
  await expect(reason).toBeEmpty()
  expect(
    (
      await page.request.put(`${api}/bank-account`, {
        data: {
          accountHolder: 'Payout Test Holder',
          accountNumber: '123456784321',
          ifsc: 'HDFC0001234',
        },
      })
    ).status(),
  ).toBe(200)
  await page
    .getByRole('button', { name: 'Refresh seller money', exact: true })
    .click()
  await expect(page.getByText('•••• 4321', { exact: true })).toBeVisible()
  await amount.fill('11.25')
  await reference.fill(`UTR-${suffix}`)
  await payout.getByRole('button', { name: 'Review payout record' }).click()
  dialog = page.getByRole('dialog', { name: 'Record this completed payout?' })
  await expect(dialog).toContainText(
    '₹11.25 already paid to account ending 4321',
  )
  await expect(dialog).toContainText('does not send money')
  await dialog.getByRole('button', { name: 'Record completed payout' }).click()
  await expect(payout.getByRole('alert')).toContainText(
    'at most the seller’s balance',
  )
  await expect(amount).toHaveValue('11.25')
  await expect(reference).toHaveValue(`UTR-${suffix}`)
  await amount.fill('1.25')
  await payout.getByRole('button', { name: 'Review payout record' }).click()
  await dialog.getByRole('button', { name: 'Record completed payout' }).click()
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    '₹9.00',
  )
  await expect(amount).toBeEmpty()
  await expect(reference).toBeEmpty()
  await amount.fill('1.00')
  await reference.fill(`utr-${suffix}`)
  await payout.getByRole('button', { name: 'Review payout record' }).click()
  await dialog.getByRole('button', { name: 'Record completed payout' }).click()
  await expect(payout.getByRole('alert')).toContainText('already recorded')
  await expect(amount).toHaveValue('1.00')
  await expect(reference).toHaveValue(`utr-${suffix}`)
  await direction.selectOption('reduce')
  await changeAmount.fill('0.25')
  await reason.fill('Correct a recorded amount')
  await adjustment.getByRole('button', { name: 'Review adjustment' }).click()
  dialog = page.getByRole('dialog', { name: 'Record this balance adjustment?' })
  await expect(dialog).toContainText('-₹0.25')
  await expect(dialog).toContainText('Correct a recorded amount')
  await dialog
    .getByRole('button', { name: 'Record adjustment', exact: true })
    .click()
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    '₹8.75',
  )
  // The server commits, but the response is lost. The UI must not invite an immediate repeat.
  await page.route(`${api}/adjustments`, async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await direction.selectOption('increase')
  await changeAmount.fill('1.00')
  await reason.fill('Response lost after commit')
  await adjustment.getByRole('button', { name: 'Review adjustment' }).click()
  await dialog
    .getByRole('button', { name: 'Record adjustment', exact: true })
    .click()
  await expect(adjustment.getByRole('alert')).toContainText(
    'result could not be confirmed',
  )
  await expect(
    adjustment.getByRole('button', { name: 'Review adjustment' }),
  ).toBeDisabled()
  await page.unroute(`${api}/adjustments`)
  await adjustment.getByRole('button', { name: 'Reload seller money' }).click()
  await expect(page.getByLabel('Current balance', { exact: true })).toHaveText(
    '₹9.75',
  )
  const ledger = z
    .object({
      items: z.array(
        z.object({
          entryType: z.string(),
          amountPaise: z.number(),
          description: z.string(),
          reference: z.string().nullable(),
        }),
      ),
    })
    .parse(await (await page.request.get(`${api}/ledger`)).json())
  expect(ledger.items.filter((item) => item.entryType === 'payout')).toEqual([
    expect.objectContaining({
      amountPaise: -125,
      reference: `UTR-${suffix.toUpperCase()}`,
    }),
  ])
  expect(
    ledger.items.filter(
      (item) => item.description === 'Response lost after commit',
    ),
  ).toHaveLength(1)
  expect(ledger.items.some((item) => item.amountPaise === 1025)).toBe(true)
  expect(ledger.items.some((item) => item.amountPaise === -25)).toBe(true)
  const history = page.getByRole('region', { name: 'Money history' })
  await expect(history.getByRole('button')).toHaveCount(0)
  await expect(
    history.getByText('Correct a recorded amount', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('region', { name: 'Seller money', exact: true })
    .scrollIntoViewIfNeeded()
  await layout(page)
  await payout
    .locator('..')
    .screenshot({ path: info.outputPath('ledger-actions-light.png') })
  await adjustment
    .locator('..')
    .screenshot({ path: info.outputPath('adjustment-light.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await payout
    .locator('..')
    .screenshot({ path: info.outputPath('ledger-actions-dark.png') })
  await adjustment
    .locator('..')
    .screenshot({ path: info.outputPath('adjustment-dark.png') })
  const sellerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: headers(),
  })
  try {
    const seller = await sellerContext.newPage()
    await signIn(seller, fixturesFor(info.project.name).sellerEmail)
    for (const [route, data] of [
      ['payouts', { amountPaise: 100, reference: 'DENIED-UTR' }],
      ['adjustments', { amountPaise: 100, reason: 'Denied write' }],
    ] as const)
      expect(
        (await seller.request.post(`${api}/${route}`, { data })).status(),
      ).toBe(403)
  } finally {
    await sellerContext.close()
  }
})
