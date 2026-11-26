import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
const couponSchema = z.object({
  id: z.string(),
  code: z.string(),
  discountType: z.string(),
  discountValue: z.number(),
  minOrderPaise: z.number(),
  maxDiscountPaise: z.number().nullable(),
  usageLimit: z.number().nullable(),
  perUserLimit: z.number().nullable(),
  usedCount: z.number(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  isActive: z.boolean(),
})
const couponPage = z.object({
  items: z.array(couponSchema),
  nextCursor: z.string().nullable(),
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

test('CP01 coupon creation, exact amounts, edits, limits and cart enforcement', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  const fixtures = z
    .object({
      couponExamples: z.record(
        z.string(),
        z.object({ id: z.string(), code: z.string() }),
      ),
      orderProducts: z.record(
        z.string(),
        z.object({ firstVariantId: z.string() }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}'))
  const exhausted = fixtures.couponExamples[info.project.name]!
  const variant = fixtures.orderProducts[info.project.name]!.firstVariantId
  await page.goto('/admin/coupons')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  await page.goto('/admin/coupons')
  const list = page.getByRole('region', { name: 'Coupon list', exact: true })
  const summary = page
    .getByRole('heading', { name: 'Saved coupon', exact: true })
    .locator('..')
  const first = couponPage.parse(
    await (await page.request.get('/api/admin/coupons?limit=20')).json(),
  )
  await expect(list.locator('li')).toHaveCount(20)
  await layout(page)
  expect(
    await list
      .locator('li')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-coupon-id')),
      ),
  ).toEqual(first.items.map((row) => row.id))
  await page.getByRole('link', { name: 'Older coupons', exact: true }).click()
  await expect(page).toHaveURL(/cursor=/)
  const older = couponPage.parse(
    await (
      await page.request.get(
        `/api/admin/coupons?limit=20&cursor=${encodeURIComponent(first.nextCursor!)}`,
      )
    ).json(),
  )
  expect(
    await list
      .locator('li')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-coupon-id')),
      ),
  ).toEqual(older.items.map((row) => row.id))
  expect(
    older.items.some((row) => first.items.some((old) => old.id === row.id)),
  ).toBe(false)
  await page.getByRole('link', { name: 'Create coupon', exact: true }).click()
  const create = page.getByRole('form', { name: 'Create coupon', exact: true })
  const code = `CP${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  await create.locator('#coupon-code').fill(code.toLowerCase())
  await create.locator('#coupon-description').fill('Browser coupon')
  await create.locator('#coupon-discount').fill('1.005')
  await create
    .getByRole('button', { name: 'Create coupon', exact: true })
    .click()
  await expect(create.getByRole('alert')).toContainText(
    'at most 2 decimal places',
  )
  await create.locator('#coupon-discount').fill('102.50')
  await create.locator('#coupon-minimum').fill('100.25')
  await create.locator('#coupon-cap').fill('50.75')
  await create.locator('#coupon-usage').fill('5')
  await create.locator('#coupon-per-buyer').fill('2')
  await create.locator('#coupon-start').fill('2026-11-01T09:15')
  await create.locator('#coupon-end').fill('2099-12-31T23:59')
  await create
    .getByRole('button', { name: 'Create coupon', exact: true })
    .click()
  await expect(create.getByRole('alert')).toContainText(
    'Percentage must be at most 100%',
  )
  await expect(create.locator('#coupon-cap')).toHaveValue('50.75')
  await create.locator('#coupon-discount').fill('25.50')
  await layout(page)
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/coupons' &&
      response.request().method() === 'POST',
  )
  await create
    .getByRole('button', { name: 'Create coupon', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  const response = await created
  expect(response.status()).toBe(201)
  const saved = z
    .object({ coupon: couponSchema })
    .parse(await response.json()).coupon
  expect(saved).toMatchObject({
    code,
    discountType: 'percent',
    discountValue: 2550,
    minOrderPaise: 10025,
    maxDiscountPaise: 5075,
    usageLimit: 5,
    perUserLimit: 2,
    usedCount: 0,
    startsAt: '2026-11-01T03:45:00.000Z',
    endsAt: '2099-12-31T18:29:00.000Z',
  })
  await expect(page).toHaveURL(new RegExp(`/admin/coupons/${saved.id}$`))
  await page.getByRole('link', { name: 'Back to coupons', exact: true }).click()
  await page.getByRole('link', { name: 'Create coupon', exact: true }).click()
  await expect(
    page
      .getByRole('form', { name: 'Create coupon', exact: true })
      .locator('#coupon-code'),
  ).toBeEmpty()
  await page.goto(`/admin/coupons/${saved.id}`)
  const edit = page.getByRole('form', {
    name: 'Edit coupon terms',
    exact: true,
  })
  await expect(edit.locator('#coupon-code')).toHaveCount(0)
  await expect(edit).toContainText('The code cannot be changed')
  await expect(edit.locator('#coupon-discount')).toBeEnabled()
  await edit.locator('label[for="coupon-discount"]').click()
  await expect(edit.locator('#coupon-discount')).toBeFocused()
  await expect(summary.getByText('25.5%', { exact: true })).toBeVisible()
  await expect(
    summary.getByText('Starts', { exact: true }).locator('..'),
  ).toContainText('09:15 am')
  await expect(summary).toContainText('India time (IST)')
  expect(
    (
      await page.request.patch(`/api/admin/coupons/${saved.id}`, {
        data: { code: 'CHANGED' },
      })
    ).status(),
  ).toBe(400)
  await layout(page)
  await edit.screenshot({ path: info.outputPath('coupon-percent-light.png') })
  await edit.locator('#coupon-type').selectOption('fixed')
  await expect(edit.locator('#coupon-discount')).toBeEmpty()
  await expect(edit.locator('#coupon-cap')).toHaveCount(0)
  await edit.locator('#coupon-discount').fill('100.25')
  await edit
    .getByRole('button', { name: 'Save coupon terms', exact: true })
    .click()
  await expect(edit.getByRole('alert')).toContainText(
    'minimum order must be more than the fixed discount',
  )
  await expect(edit.locator('#coupon-discount')).toHaveValue('100.25')
  await edit.locator('#coupon-discount').fill('10.05')
  await edit.locator('#coupon-end').fill('2026-01-01T09:15')
  await edit
    .getByRole('button', { name: 'Save coupon terms', exact: true })
    .click()
  await expect(edit.getByRole('alert')).toContainText(
    'End date must be after start date',
  )
  await edit.locator('#coupon-end').fill('2099-12-31T23:59')
  const patched = page.waitForResponse(
    (result) =>
      new URL(result.url()).pathname === `/api/admin/coupons/${saved.id}` &&
      result.request().method() === 'PATCH',
  )
  await edit
    .getByRole('button', { name: 'Save coupon terms', exact: true })
    .click()
  const patch = await patched
  expect(patch.status()).toBe(200)
  expect(patch.request().postDataJSON()).toEqual({
    discountType: 'fixed',
    discountValue: 1005,
    maxDiscountPaise: null,
  })
  await expect(
    edit.getByText('Coupon terms were saved.', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(edit.locator('#coupon-discount')).toHaveValue('10.05')
  await expect(edit.locator('#coupon-start')).toHaveValue('2026-11-01T09:15')
  await layout(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await edit.screenshot({ path: info.outputPath('coupon-fixed-dark.png') })
  const buyerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: headers(),
  })
  const sellerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: headers(),
  })
  try {
    const buyer = await buyerContext.newPage()
    await signIn(buyer)
    expect(
      (
        await buyer.request.post('/api/cart/items', {
          data: { variantId: variant, quantity: 1 },
        })
      ).status(),
    ).toBe(200)
    const applied = await buyer.request.put('/api/cart/coupon', {
      data: { code },
    })
    expect(applied.status()).toBe(200)
    expect(
      z
        .object({ cart: z.object({ discountPaise: z.number() }) })
        .parse(await applied.json()).cart.discountPaise,
    ).toBe(1005)
    await edit
      .locator('#coupon-description')
      .fill('Draft preserved while disabling')
    await page
      .getByRole('button', { name: 'Deactivate coupon', exact: true })
      .focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', {
      name: 'Deactivate coupon?',
      exact: true,
    })
    await expect(dialog).toContainText(code)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Deactivate coupon', exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await dialog
      .getByRole('button', { name: 'Deactivate coupon', exact: true })
      .click()
    await expect(summary.getByText('Disabled', { exact: true })).toBeVisible()
    await expect(edit.locator('#coupon-description')).toHaveValue(
      'Draft preserved while disabling',
    )
    await edit
      .getByRole('button', { name: 'Save coupon terms', exact: true })
      .click()
    await expect(
      edit.getByText('Coupon terms were saved.', { exact: true }),
    ).toBeVisible()
    const inactive = z
      .object({ coupon: couponSchema })
      .parse(
        await (await page.request.get(`/api/admin/coupons/${saved.id}`)).json(),
      ).coupon
    expect(inactive.isActive).toBe(false)
    const refused = await buyer.request.put('/api/cart/coupon', {
      data: { code },
    })
    expect(refused.status()).toBe(409)
    expect(await refused.text()).toContain('no longer active')
    const usedUp = await buyer.request.put('/api/cart/coupon', {
      data: { code: exhausted.code },
    })
    expect(usedUp.status()).toBe(409)
    expect(await usedUp.text()).toContain('used up')
    await page.goto(`/admin/coupons/${exhausted.id}`)
    await expect(
      summary.getByText('Total limit reached', { exact: true }),
    ).toBeVisible()
    await edit.locator('#coupon-usage').fill('1')
    await edit
      .getByRole('button', { name: 'Save coupon terms', exact: true })
      .click()
    await expect(edit.getByRole('alert')).toContainText(
      'cannot be below the 2 times',
    )
    await expect(edit.locator('#coupon-usage')).toHaveValue('1')
    await edit.locator('#coupon-usage').fill('3')
    await edit
      .getByRole('button', { name: 'Save coupon terms', exact: true })
      .click()
    await expect(
      summary.getByText('Total limit reached', { exact: true }),
    ).toHaveCount(0)
    expect(
      (
        await buyer.request.put('/api/cart/coupon', {
          data: { code: exhausted.code },
        })
      ).status(),
    ).toBe(200)
    for (const route of [
      '/api/admin/coupons',
      `/api/admin/coupons/${saved.id}`,
    ])
      expect((await buyer.request.get(route)).status()).toBe(403)
    expect(
      (
        await buyer.request.post('/api/admin/coupons', {
          data: { code: 'DENIED', discountType: 'percent', discountValue: 100 },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await buyer.request.patch(`/api/admin/coupons/${saved.id}`, {
          data: { isActive: true },
        })
      ).status(),
    ).toBe(403)
    await buyer.goto('/admin/coupons')
    await expect(buyer).toHaveURL(/\/access-denied/)
    const seller = await sellerContext.newPage()
    await signIn(seller, fixturesFor(info.project.name).sellerEmail)
    expect((await seller.request.get('/api/admin/coupons')).status()).toBe(403)
    expect(
      (
        await seller.request.patch(`/api/admin/coupons/${saved.id}`, {
          data: { isActive: true },
        })
      ).status(),
    ).toBe(403)
    await seller.goto('/admin/coupons/new')
    await expect(seller).toHaveURL(/\/access-denied/)
  } finally {
    await Promise.all([buyerContext.close(), sellerContext.close()])
  }
  await page.goto('/admin/coupons?cursor=invalid')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Coupons could not be shown' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'Show latest coupons', exact: true })
    .click()
  await expect(list.locator('li')).toHaveCount(20)
  await page.goto('/admin/coupons/00000000-0000-4000-8000-000000000000')
  await expect(
    page.getByRole('heading', {
      name: 'This page is not available',
      exact: true,
    }),
  ).toBeVisible()
})
