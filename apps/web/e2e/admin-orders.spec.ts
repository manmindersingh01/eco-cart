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

test('AO01 administrator filters, order snapshots and permissions', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  const data = z
    .object({
      orderProducts: z.record(
        z.string(),
        z.object({
          sellerEmail: z.string(),
          firstVariantId: z.string(),
          firstTitle: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).orderProducts[
    info.project.name
  ]!
  await page.goto('/admin/orders')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page)
  await page.goto('/admin/orders')
  await expect(page).toHaveURL(/\/access-denied/)
  expect(
    (
      await page.request.post('/api/cart/items', {
        data: { variantId: data.firstVariantId, quantity: 1 },
      })
    ).status(),
  ).toBe(200)
  const addressResponse = await page.request.post('/api/account/addresses', {
    data: {
      fullName: 'Admin order buyer',
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
  await page.goto(`/admin/orders/${order.id}`)
  await expect(page).toHaveURL(/\/access-denied/)
  const sellerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: page.viewportSize(),
    extraHTTPHeaders: headers(),
  })
  const adminContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: page.viewportSize(),
    extraHTTPHeaders: headers(),
  })
  try {
    const seller = await sellerContext.newPage()
    await signIn(seller, data.sellerEmail)
    await seller.goto(`/admin/orders/${order.id}`)
    await expect(seller).toHaveURL(/\/access-denied/)
    const detail = z
      .object({
        order: z.object({ lines: z.array(z.object({ id: z.string() })) }),
      })
      .parse(
        await (
          await seller.request.get(`/api/seller/orders/${order.id}`)
        ).json(),
      ).order
    expect(
      (
        await seller.request.post(`/api/seller/orders/${order.id}/shipments`, {
          data: {
            lineIds: detail.lines.map((line) => line.id),
            courierName: 'Admin test courier',
            trackingNumber: 'ADMIN123',
          },
        })
      ).status(),
    ).toBe(201)
    const admin = await adminContext.newPage()
    const errors: string[] = []
    admin.on('pageerror', (error) => errors.push(error.message))
    await signIn(admin, fixturesFor(info.project.name).adminEmail)
    await admin.goto('/admin/orders?status=confirmed')
    await expect(
      admin.getByRole('heading', { name: 'Orders', exact: true }),
    ).toBeVisible()
    await checkLayout(admin)
    await admin.screenshot({ path: info.outputPath('admin-orders-list.png') })
    await admin.getByRole('link', { name: 'Next orders', exact: true }).click()
    await expect(admin).toHaveURL(/cursor=/)
    const cursorUrl = admin.url()
    await admin.locator('h2 a[href^="/admin/orders/"]').first().click()
    await admin
      .getByRole('link', { name: 'Back to orders', exact: true })
      .click()
    await expect(admin).toHaveURL(cursorUrl)
    await admin.getByLabel('Order number').fill(order.orderNumber.toLowerCase())
    await admin.getByRole('button', { name: 'Apply filters' }).focus()
    await admin.keyboard.press('Enter')
    await expect(admin).not.toHaveURL(/cursor=/)
    await expect(admin.locator('h2 a[href^="/admin/orders/"]')).toHaveCount(1)
    const filteredQuery = new URL(admin.url()).searchParams
    await admin
      .getByRole('link', { name: `Order ${order.orderNumber}`, exact: true })
      .click()
    await expect(
      admin.getByRole('heading', { name: data.firstTitle, exact: true }),
    ).toBeVisible()
    const api = z
      .object({
        order: z.object({
          totalPaise: z.number(),
          events: z.array(
            z.object({ eventType: z.string(), note: z.string().nullable() }),
          ),
        }),
      })
      .parse(
        await (await admin.request.get(`/api/admin/orders/${order.id}`)).json(),
      ).order
    const total = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(api.totalPaise / 100)
    await expect(admin.getByText(total, { exact: true }).first()).toBeVisible()
    await expect(
      admin.getByRole('region', { name: 'Parcels', exact: true }),
    ).toContainText('ADMIN123')
    await expect(
      admin.getByRole('region', { name: 'Payments', exact: true }),
    ).toContainText('Cod')
    await expect(
      admin.getByRole('region', { name: 'Order history' }).locator('li'),
    ).toHaveCount(api.events.length)
    for (const event of api.events) {
      if (event.note)
        await expect(
          admin.getByText(event.note, { exact: true }).first(),
        ).toBeVisible()
    }
    await expect
      .poll(
        async () => {
          await admin.reload()
          return admin
            .getByRole('link', { name: 'Download PDF', exact: true })
            .count()
        },
        { timeout: 60000 },
      )
      .toBe(1)
    const invoice = admin.getByRole('link', {
      name: 'Download PDF',
      exact: true,
    })
    const href = await invoice.getAttribute('href')
    expect(href).toMatch(/\/api\/invoices\/[^/]+\/pdf$/)
    expect((await admin.request.get(href!, { maxRedirects: 0 })).status()).toBe(
      302,
    )
    await checkLayout(admin)
    await admin.screenshot({
      path: info.outputPath('admin-order-light.png'),
      fullPage: true,
    })
    await admin.emulateMedia({ colorScheme: 'dark' })
    await checkLayout(admin)
    await admin.screenshot({
      path: info.outputPath('admin-order-dark.png'),
      fullPage: true,
    })
    await admin
      .getByRole('link', { name: 'Back to orders', exact: true })
      .click()
    await expect(admin).toHaveURL(
      (url) =>
        url.pathname === '/admin/orders' &&
        url.searchParams.get('orderNumber') ===
          filteredQuery.get('orderNumber') &&
        url.searchParams.get('status') === filteredQuery.get('status') &&
        !url.searchParams.get('cursor'),
    )
    await checkLayout(admin)
    await admin.getByLabel('Refund', { exact: true }).selectOption('true')
    await admin.getByRole('button', { name: 'Apply filters' }).click()
    await expect(
      admin.getByRole('heading', { name: 'No matching orders' }),
    ).toBeVisible()
    await admin.getByRole('link', { name: 'Clear', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/orders$/)
    await expect(admin.getByLabel('Order number')).toHaveValue('')
    await expect(admin.getByLabel('Status', { exact: true })).toHaveValue('')
    await expect(admin.getByLabel('Refund', { exact: true })).toHaveValue('')
    await admin.goto('/admin/orders?cursor=invalid')
    await expect(
      admin
        .getByRole('alert')
        .filter({ hasText: 'This order list could not be opened' }),
    ).toBeVisible()
    await admin.goto('/admin/orders/not-an-id')
    await expect(
      admin.getByRole('heading', { name: 'Order not found' }),
    ).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await sellerContext.close()
    await adminContext.close()
  }
})
