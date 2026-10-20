import sharp from 'sharp'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import {
  test,
  expect,
  fixturesFor,
  expectProtectedRedirect,
} from './support/test.ts'

test.beforeAll(async ({ browser, browserName }) => {
  console.info(`Browser engine: ${browserName} ${browser.version()}`)
})

test('P01 P07 @smoke public shell and protected routes', async ({
  page,
  checkPage,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible()
  await checkPage()
  for (const path of ['/admin/settings', '/seller/products'])
    await expectProtectedRedirect(page, path)
  await page.getByLabel('Email address').focus()
  await expect(page.getByLabel('Email address')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Send sign-in code' }),
  ).toBeFocused()
  await checkPage()
})

test('P03 @smoke real buyer OTP and role protection', async ({
  page,
  checkPage,
}) => {
  const account = await signIn(page, undefined, checkPage)
  expect(account.role).toBe('buyer')
  await page.reload()
  await expect(page.getByRole('button', { name: /^Sign out/ })).toBeVisible()
  await checkPage()
  expect((await page.request.get('/api/admin/settings')).status()).toBe(403)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/access-denied/)
})

test('P03 @smoke administrator settings persist through refresh', async ({
  page,
  checkPage,
}, info) => {
  const { adminEmail } = fixturesFor(info.project.name)
  expect((await signIn(page, adminEmail)).role).toBe('admin')
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect((await page.request.get('/api/admin/settings')).status()).toBe(200)
  await page.reload()
  await checkPage()
})

test('P04 @smoke direct storage upload and real worker processing', async ({
  page,
  checkPage,
}, info) => {
  const { sellerEmail, categoryId } = fixturesFor(info.project.name)
  expect((await signIn(page, sellerEmail)).role).toBe('seller')
  const created = await page.request.post('/api/seller/products', {
    data: {
      categoryId,
      title: 'Browser test bamboo bowl',
      variants: [
        {
          sku: `E2E-${crypto.randomUUID()}`,
          pricePaise: 50000,
          mrpPaise: 60000,
          stock: 10,
        },
      ],
    },
  })
  expect(created.status()).toBe(201)
  const { product } = z
    .object({ product: z.object({ id: z.string() }) })
    .parse(await created.json())
  await page.goto(`/seller/products/${product.id}`)
  await expect(
    page.getByRole('heading', { name: 'Product photos' }),
  ).toBeVisible()
  const storageOrigin = new URL(process.env.STORAGE_ENDPOINT!).origin
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).origin === storageOrigin,
  )
  const buffer = await sharp({
    create: { width: 800, height: 800, channels: 3, background: '#27734e' },
  })
    .png()
    .toBuffer()
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'bowl.png', mimeType: 'image/png', buffer })
  expect((await uploaded).ok()).toBe(true)
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/seller/products/${product.id}`,
        )
        const body = z
          .object({
            product: z.object({
              images: z.array(z.object({ status: z.string() })),
            }),
          })
          .parse(await response.json())
        return body.product.images[0]?.status
      },
      { timeout: 60_000 },
    )
    .toBe('ready')
  const image = page.getByRole('img', { name: 'Browser test bamboo bowl' })
  // Observe the editor's own polling finish before navigating away. A server
  // read can become ready while the browser still has a poll in flight.
  await expect(image).toBeVisible()
  await page.reload()
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute('src', /\/images\//)
  await checkPage()
  const remove = page.getByRole('button', { name: 'Delete photo', exact: true })
  await remove.click()
  const dialog = page.getByRole('dialog', { name: 'Delete this photo?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(
    dialog.getByRole('button', { name: 'Delete photo', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await checkPage()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(remove).toBeFocused()
  await page.screenshot({
    path: info.outputPath('product-editor.png'),
    fullPage: true,
  })
})
