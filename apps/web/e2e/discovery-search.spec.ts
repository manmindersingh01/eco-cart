import { expect, test, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'

const resultSchema = z
  .object({
    items: z.array(
      z
        .object({ id: z.string(), title: z.string(), slug: z.string() })
        .passthrough(),
    ),
    nextCursor: z.string().nullable(),
  })
  .passthrough()
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
test('DS01 natural fallback, response rendering, navigation and private photo upload', async ({
  page,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
  })
  await page.goto('/search')
  const modes = page.getByRole('navigation', {
    name: 'Search mode',
    exact: true,
  })
  await modes
    .getByRole('link', { name: 'Natural language', exact: true })
    .click()
  const natural = page.getByRole('form', {
    name: 'Natural language search',
    exact: true,
  })
  const results = page.getByRole('region', {
    name: 'Search results',
    exact: true,
  })
  await natural
    .getByLabel('Describe what you need', { exact: false })
    .fill('bamboo bottle')
  await natural
    .getByRole('button', { name: 'Search products', exact: true })
    .click()
  await expect(page).toHaveURL(/mode=natural/)
  await expect(
    results.getByText('Showing keyword matches', { exact: true }),
  ).toBeVisible()
  await expect(results.getByRole('article').first()).toBeVisible()
  await expect(
    page.getByRole('searchbox', { name: 'Search products', exact: true }),
  ).toHaveValue('')
  await natural.getByLabel('Lowest price (₹)', { exact: true }).fill('1.005')
  await natural
    .getByRole('button', { name: 'Search products', exact: true })
    .click()
  await expect(natural.getByRole('alert')).toContainText('Lowest price:')
  await natural.getByLabel('Lowest price (₹)', { exact: true }).fill('10.05')
  await natural.getByLabel('Highest price (₹)', { exact: true }).fill('500')
  await natural
    .getByRole('button', { name: 'Search products', exact: true })
    .click()
  await expect(page).toHaveURL(/minPricePaise=1005/)
  await expect(
    results.getByText('Showing keyword matches', { exact: true }),
  ).toBeVisible()
  await page.goto('/search?mode=natural&q=bamboo&limit=2')
  await expect(results.getByRole('article')).toHaveCount(2)
  const first = resultSchema.parse(
    await (
      await page.request.get('/api/search/natural?q=bamboo&limit=2')
    ).json(),
  )
  expect(first.nextCursor).not.toBeNull()
  await results.getByRole('link', { name: 'Next page', exact: true }).click()
  await expect(page).toHaveURL(/cursor=/)
  const second = resultSchema.parse(
    await (
      await page.request.get(
        `/api/search/natural?q=bamboo&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      )
    ).json(),
  )
  await expect(
    results.getByRole('link', { name: second.items[0]!.title, exact: true }),
  ).toBeVisible()
  expect(
    second.items.every(
      (item) => !first.items.some((old) => old.id === item.id),
    ),
  ).toBe(true)
  await results
    .getByRole('link', { name: 'Back to the first page', exact: true })
    .click()
  await expect(page).not.toHaveURL(/cursor=/)
  await expect(
    results.getByRole('link', { name: first.items[0]!.title, exact: true }),
  ).toBeVisible()

  const naturalRoute = '**/api/search/natural?**'
  await page.route(naturalRoute, (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'PRIVATE_PROVIDER_DETAIL' }),
    }),
  )
  await page.goto('/search?mode=natural&q=limited')
  await expect(results).toContainText('daily allowance')
  expect(await page.content()).not.toContain('PRIVATE_PROVIDER_DETAIL')
  await page.unroute(naturalRoute)
  const understood = {
    query: '<script>unsafe()</script> bamboo',
    category: null,
    brand: null,
    minPricePaise: 1005,
    maxPricePaise: 50000,
  }
  await page.route(naturalRoute, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...first,
        nextCursor: null,
        match: 'meaning',
        understood,
      }),
    }),
  )
  await page.goto('/search?mode=natural&q=understood')
  await expect(
    results.getByText('What we understood', { exact: true }),
  ).toBeVisible()
  await expect(results).toContainText(understood.query)
  await expect(results.locator('script')).toHaveCount(0)
  await expect(results).toContainText('₹10.05')
  await expect(results).toContainText('₹500.00')
  await expect(
    natural.getByLabel('Describe what you need', { exact: false }),
  ).toBeEnabled()
  await layout(page)
  await page.screenshot({
    path: info.outputPath('natural-search-light.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await page.screenshot({
    path: info.outputPath('natural-search-dark.png'),
    fullPage: true,
  })
  await page.unroute(naturalRoute)
  await modes.getByRole('link', { name: 'Keyword', exact: true }).click()
  await page
    .getByRole('searchbox', { name: 'Search products', exact: true })
    .fill('bamboo')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page).not.toHaveURL(/mode=/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Results for',
  )

  await modes.getByRole('link', { name: 'Photo', exact: true }).click()
  const photo = page.getByRole('form', { name: 'Photo search', exact: true })
  const input = photo.getByLabel('Search photo', { exact: true })
  await input.setInputFiles({
    name: 'bad.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  })
  await expect(photo.getByRole('alert')).toContainText('JPEG, PNG or WebP')
  await input.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  })
  await expect(photo.getByRole('alert')).toContainText('5 MB')
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#27734e' },
  })
    .png()
    .toBuffer()
  await input.setInputFiles({
    name: 'bottle.png',
    mimeType: 'image/png',
    buffer,
  })
  const storageOrigin = new URL(process.env.STORAGE_ENDPOINT!).origin
  const refused = '**/search-upload-refused'
  await page.route('**/api/search/photo/uploads', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        upload: {
          key: 'private-test-key',
          url: `${process.env.E2E_BASE_URL}/search-upload-refused`,
          fields: {},
          maxBytes: 5 * 1024 * 1024,
        },
      }),
    }),
  )
  await page.route(refused, (route) =>
    route.fulfill({ status: 403, body: 'PRIVATE_STORAGE_DETAIL' }),
  )
  await photo
    .getByRole('button', { name: 'Search products', exact: true })
    .click()
  await expect(photo.getByRole('alert')).toContainText(
    'photo upload could not finish',
  )
  expect(await page.content()).not.toContain('PRIVATE_STORAGE_DETAIL')
  await page.unroute('**/api/search/photo/uploads')
  await page.unroute(refused)
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).origin === storageOrigin,
  )
  const signedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/search/photo/uploads') &&
      response.request().method() === 'POST',
  )
  await photo
    .getByRole('button', { name: 'Search products', exact: true })
    .click()
  expect((await uploadResponse).ok()).toBe(true)
  const signed = z
    .object({ upload: z.object({ key: z.string() }) })
    .parse(await (await signedResponse).json())
  await expect(results).toContainText('unavailable right now')
  expect(page.url()).not.toContain('photo=')
  expect(await page.content()).not.toContain(signed.upload.key)
  await expect(results.locator('img')).toHaveCount(0)

  const photoRequests: URL[] = []
  await page.route('**/api/search/photo?**', (route) => {
    const url = new URL(route.request().url())
    photoRequests.push(url)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        url.searchParams.has('cursor')
          ? { items: [], nextCursor: null }
          : { ...first, nextCursor: 'photo-next-cursor' },
      ),
    })
  })
  await results.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(results.getByRole('article')).toHaveCount(2)
  await photo.getByLabel('Lowest price (₹)', { exact: true }).fill('10.05')
  await photo
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click()
  await expect
    .poll(() => photoRequests.at(-1)?.searchParams.get('minPricePaise'))
    .toBe('1005')
  await results.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(
    results.getByText('No more results', { exact: true }),
  ).toBeVisible()
  expect(photoRequests.at(-1)?.searchParams.get('cursor')).toBe(
    'photo-next-cursor',
  )
  await results
    .getByRole('button', { name: 'Back to the first page', exact: true })
    .click()
  await expect(results.getByRole('article')).toHaveCount(2)
  expect(photoRequests.at(-1)?.searchParams.has('cursor')).toBe(false)
  expect(page.url()).not.toContain('photo=')
  expect(await page.content()).not.toContain(signed.upload.key)
  await layout(page)
  await page.screenshot({
    path: info.outputPath('photo-search-dark.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await layout(page)
  await page.screenshot({
    path: info.outputPath('photo-search-light.png'),
    fullPage: true,
  })
  const card = results.getByRole('link', {
    name: first.items[0]!.title,
    exact: true,
  })
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/products/${first.items[0]!.slug}$`))
})
