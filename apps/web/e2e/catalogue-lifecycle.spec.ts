import { randomInt } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { AxeBuilder } from '@axe-core/playwright'
import { test, expect, fixturesFor } from './support/test.ts'
import { signIn } from './support/auth.ts'
import { ownProduct, confirmAction } from './support/catalogue.ts'

test.beforeAll(async ({ browser, browserName }) => {
  console.info(`Browser engine: ${browserName} ${browser.version()}`)
})

test('C01 C02 C05 C06 @smoke quantity, review decisions and public visibility', async ({
  page,
  browser,
  checkPage,
}, info) => {
  test.setTimeout(180000)
  const { sellerEmail, adminEmail, categoryId } = fixturesFor(info.project.name)
  await signIn(page, sellerEmail)
  await page.goto('/seller/products/new')
  await page.getByLabel('Leaf category').selectOption(categoryId)
  await expect(
    page.getByLabel('Minimum quantity', { exact: true }),
  ).toHaveValue('1')
  await page.getByLabel('Minimum quantity', { exact: true }).fill('10')
  await page.getByLabel('Product title').fill('Catalogue lifecycle bamboo bowl')
  await page
    .getByRole('textbox', { name: 'SKU', exact: true })
    .fill(`LIFE-${crypto.randomUUID()}`)
  await page.getByLabel(/^Selling price/).fill('100')
  await page.getByLabel(/^MRP/).fill('120')
  await page.getByRole('spinbutton', { name: 'Stock', exact: true }).fill('20')
  await page
    .getByRole('button', { name: 'Create product draft', exact: true })
    .click()
  await expect(page).toHaveURL(/\/seller\/products\/[a-f0-9-]+$/)
  const product = await ownProduct(page, page.url().split('/').at(-1)!)
  await expect(
    page.getByLabel('Minimum quantity', { exact: true }),
  ).toBeEnabled()
  await expect(
    page.getByLabel('Minimum quantity', { exact: true }),
  ).toHaveValue('10')
  await page
    .getByLabel('Description', { exact: true })
    .fill('A reusable bowl, updated description.')
  await page
    .getByRole('button', { name: 'Save listing details', exact: true })
    .click()
  await expect
    .poll(async () => (await ownProduct(page, product.id)).description)
    .toContain('updated description')
  await page.reload()
  await expect(
    page.getByLabel('Minimum quantity', { exact: true }),
  ).toHaveValue('10')
  expect(
    (
      await page.request.patch(`/api/seller/products/${product.id}`, {
        data: { minOrderQuantity: 0 },
      })
    ).status(),
  ).toBe(400)
  await confirmAction(page, 'Submit for review')
  await expect(
    page.getByText(/cannot be submitted for review yet/),
  ).toBeVisible()
  const buffer = await sharp({
    create: { width: 800, height: 800, channels: 3, background: '#27734e' },
  })
    .png()
    .toBuffer()
  await expect(
    page.locator('input[type="file"][aria-label="Product photos"]'),
  ).toBeEnabled()
  await page
    .locator('input[type="file"][aria-label="Product photos"]')
    .setInputFiles({ name: 'bowl.png', mimeType: 'image/png', buffer })
  await expect
    .poll(async () => (await ownProduct(page, product.id)).images[0]?.status, {
      timeout: 60000,
    })
    .toBe('ready')
  await expect(page.getByText('Cover photo', { exact: true })).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('img', {
      name: 'Catalogue lifecycle bamboo bowl',
      exact: true,
    }),
  ).toBeVisible()
  await confirmAction(page, 'Submit for review')
  await expect
    .poll(async () => (await ownProduct(page, product.id)).status)
    .toBe('pending_review')
  await confirmAction(page, 'Withdraw from review')
  await expect
    .poll(async () => (await ownProduct(page, product.id)).status)
    .toBe('draft')
  await confirmAction(page, 'Submit for review')
  const adminContext = await browser.newContext({
    viewport: page.viewportSize(),
    extraHTTPHeaders: {
      'x-forwarded-for': `198.19.${randomInt(256)}.${randomInt(1, 255)}`,
    },
  })
  const admin = await adminContext.newPage()
  try {
    await signIn(admin, adminEmail)
    await admin.goto('/admin/moderation')
    await admin.getByLabel('Screening risk').selectOption('low')
    await admin.locator(`a[href="/admin/moderation/${product.id}"]`).click()
    await expect(
      admin.getByRole('heading', { name: 'Review listing', exact: true }),
    ).toBeVisible()
    expect(
      await admin.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    expect(
      (await new AxeBuilder({ page: admin }).analyze()).violations,
    ).toEqual([])
    await admin.screenshot({
      path: info.outputPath('administrator-review.png'),
      fullPage: true,
    })
    await expect
      .poll(
        async () => {
          await admin
            .getByRole('button', { name: 'Refresh screening', exact: true })
            .click()
          return admin
            .getByRole('button', { name: 'Approve listing', exact: true })
            .isEnabled()
        },
        { timeout: 60000 },
      )
      .toBe(true)
    await admin
      .getByLabel('Decision reason')
      .fill('Please improve the description.')
    await confirmAction(admin, 'Reject listing')
    await expect(admin.getByText('Review decision saved.')).toBeVisible()
    await page.reload()
    await expect(
      page.getByText('Please improve the description.', { exact: true }),
    ).toBeVisible()
    await page
      .getByLabel('Description', { exact: true })
      .fill('A corrected reusable bamboo bowl description.')
    await page
      .getByRole('button', { name: 'Save listing details', exact: true })
      .click()
    await expect
      .poll(async () => (await ownProduct(page, product.id)).description)
      .toContain('corrected')
    await confirmAction(page, 'Submit for review')
    await admin.reload()
    await expect
      .poll(
        async () => {
          await admin
            .getByRole('button', { name: 'Refresh screening', exact: true })
            .click()
          return admin
            .getByRole('button', { name: 'Approve listing', exact: true })
            .isEnabled()
        },
        { timeout: 60000 },
      )
      .toBe(true)
    await confirmAction(admin, 'Approve listing')
    await expect(admin.getByText('Review decision saved.')).toBeVisible()
    expect(
      (await page.request.get(`/api/products/${product.slug}`)).status(),
    ).toBe(200)
    await page.reload()
    await page.getByLabel('Minimum quantity', { exact: true }).fill('21')
    await page.getByRole('button', { name: 'Save minimum quantity' }).click()
    await expect
      .poll(async () => (await ownProduct(page, product.id)).minOrderQuantity)
      .toBe(21)
    await expect(
      page.getByText('Minimum quantity saved.', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Not enough stock for the minimum order', { exact: true }),
    ).toBeVisible()
    await expect
      .poll(
        async () =>
          z
            .object({ product: z.object({ inStock: z.boolean() }) })
            .parse(
              await (
                await page.request.get(`/api/products/${product.slug}`)
              ).json(),
            ).product.inStock,
      )
      .toBe(false)
    await page.getByLabel('Minimum quantity', { exact: true }).fill('11')
    await page.getByRole('button', { name: 'Save minimum quantity' }).click()
    await expect
      .poll(async () => (await ownProduct(page, product.id)).minOrderQuantity)
      .toBe(11)
    await checkPage()
    await page.screenshot({
      path: info.outputPath('approved-product.png'),
      fullPage: true,
    })
    await confirmAction(page, 'Archive product')
    await expect
      .poll(async () => (await ownProduct(page, product.id)).status)
      .toBe('archived')
    await expect
      .poll(async () =>
        (await page.request.get(`/api/products/${product.slug}`)).status(),
      )
      .toBe(404)
    await confirmAction(page, 'Restore to draft')
    await expect
      .poll(async () => (await ownProduct(page, product.id)).status)
      .toBe('draft')
    await confirmAction(page, 'Submit for review')
    await admin.reload()
    await expect
      .poll(
        async () => {
          await admin
            .getByRole('button', { name: 'Refresh screening', exact: true })
            .click()
          return admin
            .getByRole('button', { name: 'Approve listing', exact: true })
            .isEnabled()
        },
        { timeout: 60000 },
      )
      .toBe(true)
    await confirmAction(admin, 'Approve listing')
    await expect(admin.getByText('Review decision saved.')).toBeVisible()
    await expect
      .poll(async () =>
        (await page.request.get(`/api/products/${product.slug}`)).status(),
      )
      .toBe(200)
    await admin
      .getByLabel('Decision reason')
      .fill('Taken down for a catalogue correction.')
    await confirmAction(admin, 'Take down listing', 'Take listing down?')
    await expect(admin.getByText('Review decision saved.')).toBeVisible()
    await expect
      .poll(async () =>
        (await page.request.get(`/api/products/${product.slug}`)).status(),
      )
      .toBe(404)
    expect(
      (await admin.request.get(`/api/seller/products/${product.id}`)).status(),
    ).toBe(403)
    await page.reload()
    await checkPage()
    await info.attach('catalogue-proof.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        productId: product.id,
        slug: product.slug,
        final: await ownProduct(page, product.id),
      }),
    })
    const stranger = await browser.newContext({
      extraHTTPHeaders: {
        'x-forwarded-for': `198.19.${randomInt(256)}.${randomInt(1, 255)}`,
      },
    })
    try {
      const other = await stranger.newPage()
      await signIn(other, fixturesFor(info.project.name).otherSellerEmail)
      expect(
        (
          await other.request.get(`/api/seller/products/${product.id}`)
        ).status(),
      ).toBe(404)
    } finally {
      await stranger.close()
    }
  } finally {
    await adminContext.close()
  }
})
