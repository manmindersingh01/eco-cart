import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})

const productFixture = z.object({
  sellerEmail: z.string(),
  otherSellerEmail: z.string(),
  firstVariantId: z.string(),
  secondVariantId: z.string(),
  firstTitle: z.string(),
  secondTitle: z.string(),
})

async function checkLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await expect
    .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
    .toEqual([])
}

test('SO01 seller orders, isolation, cursors and invoice errors', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  const fixtures = z
    .object({ orderProducts: z.record(z.string(), productFixture) })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}'))
  const data = fixtures.orderProducts[info.project.name]!
  await page.goto('/seller/orders')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page)
  await page.goto('/seller/orders')
  await expect(page).toHaveURL(/\/access-denied/)
  for (const variantId of [data.firstVariantId, data.secondVariantId]) {
    expect(
      (
        await page.request.post('/api/cart/items', {
          data: { variantId, quantity: 1 },
        })
      ).status(),
    ).toBe(200)
  }
  const addressResponse = await page.request.post('/api/account/addresses', {
    data: {
      fullName: 'Asha Order Test',
      phone: '+919812345678',
      line1: '14 Lake Road',
      city: 'Bengaluru',
      stateCode: '29',
      pincode: '560001',
    },
  })
  expect(addressResponse.status()).toBe(201)
  const address = z
    .object({ address: z.object({ id: z.string() }) })
    .parse(await addressResponse.json()).address
  const placed = await page.request.post('/api/checkout', {
    data: { addressId: address.id, paymentMethod: 'cod' },
  })
  expect(placed.status()).toBe(201)
  const order = z
    .object({ order: z.object({ id: z.string(), orderNumber: z.string() }) })
    .parse(await placed.json()).order
  const sellerContext = await browser.newContext({
    extraHTTPHeaders: headers(),
    viewport: page.viewportSize(),
    baseURL: process.env.E2E_BASE_URL,
  })
  const otherContext = await browser.newContext({
    extraHTTPHeaders: headers(),
    viewport: page.viewportSize(),
    baseURL: process.env.E2E_BASE_URL,
  })
  const seller = await sellerContext.newPage()
  const other = await otherContext.newPage()
  try {
    await signIn(seller, data.sellerEmail)
    await signIn(other, data.otherSellerEmail)
    await seller.goto('/seller/orders')
    await expect(
      seller.getByRole('heading', { name: 'Orders', exact: true }),
    ).toBeVisible()
    await checkLayout(seller)
    await seller.screenshot({ path: info.outputPath('seller-orders-list.png') })
    const privateOrder = await seller
      .locator('h2 a[href^="/seller/orders/"]')
      .first()
      .getAttribute('href')
    await other.goto(privateOrder!)
    await expect(
      other.getByRole('heading', { name: 'Order not found' }),
    ).toBeVisible()
    await seller.getByRole('link', { name: 'Next orders', exact: true }).click()
    await expect(seller).toHaveURL(/cursor=/)
    const cursorUrl = seller.url()
    await seller.reload()
    await expect(
      seller.getByRole('link', {
        name: `Order ${order.orderNumber}`,
        exact: true,
      }),
    ).toBeVisible()
    await seller.getByRole('link', { name: 'Dispatched', exact: true }).click()
    await expect(seller).not.toHaveURL(/cursor=/)
    await expect(
      seller.getByRole('heading', { name: 'No orders in this status' }),
    ).toBeVisible()
    await seller.goBack()
    await expect(seller).toHaveURL(cursorUrl)
    await seller.goto(`/seller/orders/${order.id}`)
    await expect(
      seller.getByRole('heading', { name: data.firstTitle, exact: true }),
    ).toBeVisible()
    await expect(
      seller.getByText(data.secondTitle, { exact: true }),
    ).toHaveCount(0)
    await expect(
      seller.getByText('14 Lake Road', { exact: true }),
    ).toBeVisible()
    await expect(
      seller.getByRole('link', { name: '+919812345678', exact: true }),
    ).toBeVisible()
    await checkLayout(seller)
    await seller.screenshot({
      path: info.outputPath('seller-order-light.png'),
      fullPage: true,
    })
    await seller.emulateMedia({ colorScheme: 'dark' })
    await checkLayout(seller)
    await seller.screenshot({
      path: info.outputPath('seller-order-dark.png'),
      fullPage: true,
    })
    await seller
      .getByRole('button', { name: 'Refresh order', exact: true })
      .focus()
    await seller.keyboard.press('Enter')
    await expect(
      seller.getByRole('button', { name: 'Refresh order', exact: true }),
    ).toBeEnabled()
    await expect
      .poll(
        async () => {
          await seller.reload()
          return seller
            .getByRole('link', { name: 'Download PDF', exact: true })
            .count()
        },
        { timeout: 60000 },
      )
      .toBe(1)
    const download = seller.getByRole('link', {
      name: 'Download PDF',
      exact: true,
    })
    const href = await download.getAttribute('href')
    expect(href).toMatch(/\/api\/invoices\/[^/]+\/pdf\?as=seller$/)
    expect(
      (await seller.request.get(href!, { maxRedirects: 0 })).status(),
    ).toBe(302)
    expect(
      (
        await seller.request.get(href!.replace('?as=seller', ''), {
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(404)
    await seller.route('**/api/invoices/*/pdf?as=seller', async (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The invoice PDF is not ready yet' }),
      }),
    )
    await download.click()
    await expect(
      seller.getByRole('alert').filter({ hasText: 'Invoice unavailable' }),
    ).toContainText('The invoice PDF is not ready yet')
    await checkLayout(seller)
    await seller.unroute('**/api/invoices/*/pdf?as=seller')
    const downloaded = seller.waitForEvent('download')
    await download.click()
    expect(await (await downloaded).failure()).toBeNull()
    await other.goto(`/seller/orders/${order.id}`)
    await expect(
      other.getByRole('heading', { name: data.secondTitle, exact: true }),
    ).toBeVisible()
    await expect(other.getByText(data.firstTitle, { exact: true })).toHaveCount(
      0,
    )
    expect((await other.request.get(href!, { maxRedirects: 0 })).status()).toBe(
      404,
    )
    const read = await other.request.get(`/api/seller/orders/${order.id}`)
    const detail = z
      .object({
        order: z.object({ lines: z.array(z.object({ id: z.string() })) }),
      })
      .parse(await read.json()).order
    await other.getByRole('checkbox').check()
    await other.getByLabel('Courier name').fill('Test courier')
    await other.getByLabel(/^Tracking number/).fill('TEST12345')
    await other
      .getByLabel('Tracking link (optional)')
      .fill('https://example.test/tracking/TEST12345')
    await other
      .getByRole('button', { name: 'Record dispatch', exact: true })
      .click()
    await expect(other.getByText('Tracking: TEST12345')).toBeVisible()
    const repeated = await other.request.post(
      `/api/seller/orders/${order.id}/shipments`,
      {
        data: {
          lineIds: detail.lines.map((line) => line.id),
          courierName: 'Test courier',
          trackingNumber: 'TEST12345',
        },
      },
    )
    expect(repeated.status()).toBe(409)
    await other
      .getByRole('button', { name: 'Refresh order', exact: true })
      .click()
    await expect(other.getByText('Tracking: TEST12345')).toBeVisible()
    await other.goto('/seller/orders?tab=dispatched')
    await expect(
      other.getByRole('link', {
        name: `Order ${order.orderNumber}`,
        exact: true,
      }),
    ).toBeVisible()
    await other.goto(`/seller/orders/${order.id}`)
    await other
      .getByRole('button', { name: 'Mark delivered', exact: true })
      .click()
    await other
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm delivery' })
      .click()
    await expect(
      other.getByRole('button', { name: 'Mark delivered', exact: true }),
    ).toHaveCount(0)
    await checkLayout(other)
    await seller.goto(`/seller/orders/${order.id}`)
    await seller.getByRole('checkbox').check()
    await seller.getByLabel('Courier name').fill('Second courier')
    await seller.getByLabel(/^Tracking number/).fill('SECOND123')
    await seller
      .getByRole('button', { name: 'Record dispatch', exact: true })
      .click()
    await expect(seller.getByText('Tracking: SECOND123')).toBeVisible()
    await seller
      .getByRole('button', { name: 'Mark delivered', exact: true })
      .click()
    await seller
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm delivery' })
      .click()
    await expect
      .poll(async () => {
        const result = await page.request.get(`/api/account/orders/${order.id}`)
        return z
          .object({ order: z.object({ paymentState: z.string() }) })
          .parse(await result.json()).order.paymentState
      })
      .toBe('paid')
    await seller.goto('/seller/orders?tab=cancelled')
    await expect(
      seller.getByRole('heading', { name: 'No orders in this status' }),
    ).toBeVisible()
    await seller.goto('/seller/orders?tab=delivered')
    await expect(
      seller.getByRole('link', {
        name: `Order ${order.orderNumber}`,
        exact: true,
      }),
    ).toBeVisible()
    await seller.goto('/seller/orders?tab=unknown')
    await expect(
      seller
        .getByRole('alert')
        .filter({ hasText: 'This order list could not be opened' }),
    ).toContainText('This order list could not be opened')
    await seller.goto('/seller/orders?cursor=invalid')
    await expect(
      seller
        .getByRole('alert')
        .filter({ hasText: 'This order list could not be opened' }),
    ).toContainText('This order list could not be opened')
    await seller.goto('/seller/orders/not-an-id')
    await expect(
      seller.getByRole('heading', { name: 'Order not found' }),
    ).toBeVisible()
  } finally {
    await sellerContext.close()
    await otherContext.close()
  }
})
