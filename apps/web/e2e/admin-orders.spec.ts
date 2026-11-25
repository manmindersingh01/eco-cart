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
      .getByRole('button', { name: 'Mark delivered', exact: true })
      .click()
    await expect(admin.getByRole('dialog')).toContainText(
      'confirm payment was collected',
    )
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm delivery' })
      .click()
    await expect(
      admin.getByText('Cash collected', { exact: true }),
    ).toBeVisible()
    await expect(
      admin.getByRole('button', { name: 'Mark delivered', exact: true }),
    ).toHaveCount(0)
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

test('AO02 administrator cancellation, refund recording and invoice requests', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  const data = z
    .object({
      orderProducts: z.record(
        z.string(),
        z.object({ refundOrderId: z.string() }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).orderProducts[
    info.project.name
  ]!
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  const path = `/admin/orders/${data.refundOrderId}`
  await page.goto(path)
  await expect(
    page.getByRole('button', { name: 'Cancel order', exact: true }),
  ).toBeDisabled()
  await page
    .getByLabel('Cancellation reason')
    .fill('The seller cannot supply this item')
  const stale = await page.context().newPage()
  await stale.goto(path)
  await stale
    .getByLabel('Cancellation reason')
    .fill('Already cancelled in another tab')
  await page.getByRole('button', { name: 'Cancel order', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText(
    'make the refund separately',
  )
  await checkLayout(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('admin-cancel-dialog-dark.png'),
  })
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm cancellation' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Record an already-made refund' }),
  ).toBeVisible()
  await stale.getByRole('button', { name: 'Cancel order', exact: true }).click()
  const conflict = stale.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/orders/${data.refundOrderId}/cancel`),
  )
  await stale
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm cancellation' })
    .click()
  expect((await conflict).status()).toBe(409)
  await expect(
    stale.getByRole('button', { name: 'Cancel order', exact: true }),
  ).toHaveCount(0)
  await expect(
    stale.getByRole('alert').filter({ hasText: /cancelled/ }),
  ).toBeVisible()
  await stale.close()
  await expect(
    page.getByText('No money is moved', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Refund amount (₹)')).toHaveValue('123.45')
  await page.getByLabel('Refund amount (₹)').fill('123.456')
  await expect(
    page.getByRole('button', { name: 'Record refund', exact: true }),
  ).toBeDisabled()
  await page.getByLabel('Refund amount (₹)').fill('123.44')
  await page
    .getByLabel('Razorpay refund ID', { exact: false })
    .fill(
      `rfnd_${'A'.repeat(13)}${info.project.name === 'chrome-phone' ? 'P' : info.project.name === 'chrome-medium' ? 'M' : 'D'}`,
    )
  await page.getByRole('button', { name: 'Record refund', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('No money is moved')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm refund record' })
    .click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'That refund cannot be recorded' }),
  ).toContainText('123.45')
  await page.getByLabel('Refund amount (₹)').fill('123.45')
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('admin-refund-dark.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await checkLayout(page)
  await page.screenshot({
    path: info.outputPath('admin-refund-light.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Record refund', exact: true }).click()
  const refund = page.waitForRequest(
    (request) =>
      request
        .url()
        .endsWith(`/api/admin/orders/${data.refundOrderId}/refund`) &&
      request.method() === 'POST',
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm refund record' })
    .click()
  expect((await refund).postDataJSON()).toMatchObject({
    amountPaise: 12345,
    method: 'gateway',
  })
  await expect(page.getByText('Refunded', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Record refund', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'Order history' }),
  ).toContainText('Refund recorded')
  const invoiceRoute = '**/api/admin/invoices/*/render'
  await page.route(invoiceRoute, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'The invoice queue is unavailable. Try again.',
      }),
    }),
  )
  await page.getByRole('button', { name: 'Make PDF again' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Queue invoice PDF' })
    .click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'invoice queue is unavailable' }),
  ).toBeVisible()
  await page.unroute(invoiceRoute)
  await page.getByRole('button', { name: 'Make PDF again' }).click()
  const queued = page.waitForResponse((response) =>
    /\/api\/admin\/invoices\/[^/]+\/render$/.test(response.url()),
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Queue invoice PDF' })
    .click()
  expect((await queued).status()).toBe(202)
  await expect(
    page.getByRole('status').filter({ hasText: 'PDF generation queued' }),
  ).toBeVisible()
  await expect
    .poll(
      async () => {
        await page.reload()
        return page
          .getByRole('link', { name: 'Download PDF', exact: true })
          .count()
      },
      { timeout: 60000 },
    )
    .toBe(1)
})
