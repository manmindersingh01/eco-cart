import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
const listSchema = z.object({
  items: z.array(z.object({ id: z.string(), verifiedPurchase: z.boolean() })),
  nextCursor: z.string().nullable(),
})
const reviewSchema = z.object({
  review: z.object({
    id: z.string(),
    rating: z.number(),
    status: z.string(),
    verifiedPurchase: z.boolean(),
  }),
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

test('RV01 buyer reviews, moderation, cursor pages and server-owned ratings', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  const fixture = z
    .object({
      reviewProducts: z.record(
        z.string(),
        z.object({ slug: z.string(), buyerEmail: z.string() }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).reviewProducts[
    info.project.name
  ]!
  const productPath = `/products/${fixture.slug}`
  const api = `/api/products/${fixture.slug}/reviews`
  await page.goto(productPath)
  const published = page.getByRole('region', { name: 'Reviews', exact: true })
  const own = page.getByRole('region', { name: 'Your review', exact: true })
  await expect(
    own.getByRole('link', { name: 'Sign in to review' }),
  ).toHaveAttribute(
    'href',
    `/sign-in?${new URLSearchParams({ returnTo: `${productPath}#your-review` })}`,
  )
  await expect(published.locator('li')).toHaveCount(10)
  const initial = listSchema.parse(
    await (await page.request.get(`${api}?limit=10`)).json(),
  )
  expect(
    await published
      .locator('li')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-review-id')),
      ),
  ).toEqual(initial.items.map((row) => row.id))
  await expect(
    published.getByText('Verified purchase', { exact: true }),
  ).toHaveCount(0)
  const publicRead = `**${api}?*`
  await page.route(publicRead, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Reviews are temporarily unavailable.' }),
    }),
  )
  await published
    .getByRole('button', { name: 'Load more reviews', exact: true })
    .click()
  await expect(published.getByRole('alert')).toContainText(
    'temporarily unavailable',
  )
  await expect(published.locator('li')).toHaveCount(10)
  await page.unroute(publicRead)
  await published
    .getByRole('button', { name: 'Load more reviews', exact: true })
    .click()
  await expect(published.locator('li')).toHaveCount(11)
  const ids = await published
    .locator('li')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-review-id')),
    )
  expect(new Set(ids).size).toBe(11)
  await signIn(page, fixture.buyerEmail)
  const mine = `**${api}/mine`
  await page.route(mine, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Your review is temporarily unavailable.',
      }),
    }),
  )
  await page.goto(productPath)
  await expect(own.getByRole('alert')).toContainText('temporarily unavailable')
  await page.unroute(mine)
  await own
    .getByRole('button', { name: 'Retry loading your review', exact: true })
    .click()
  const author = own.locator('#review-name')
  const title = own.locator('#review-title')
  const body = own.locator('#review-body')
  const rating = own.locator('#review-rating')
  const reviewTitle = `My review ${info.project.name}`
  await author.fill('   ')
  await title.fill(reviewTitle)
  await body.fill('Reusable and useful. <b>This stays plain text.</b>')
  await own.getByRole('button', { name: 'Publish review', exact: true }).click()
  await expect(own.getByRole('alert')).toContainText('not valid')
  await expect(title).toHaveValue(reviewTitle)
  await author.fill('Priya S.')
  const posted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === api &&
      response.request().method() === 'POST',
  )
  await own.getByRole('button', { name: 'Publish review', exact: true }).focus()
  await page.keyboard.press('Enter')
  const created = await posted
  expect(created.status()).toBe(201)
  expect(Object.keys(created.request().postDataJSON()).toSorted()).toEqual([
    'authorName',
    'body',
    'rating',
    'title',
  ])
  const review = reviewSchema.parse(await created.json()).review
  expect(review.verifiedPurchase).toBe(true)
  await expect(
    own.getByText('Verified purchase', { exact: true }),
  ).toBeVisible()
  await expect(
    own.getByRole('button', { name: 'Save review changes', exact: true }),
  ).toBeEnabled()
  expect(
    (
      await page.request.post(api, {
        data: { rating: 5, authorName: 'Duplicate' },
      })
    ).status(),
  ).toBe(409)
  await rating.selectOption('1')
  await own
    .getByRole('button', { name: 'Save review changes', exact: true })
    .click()
  await expect(
    own.getByText('Your review was saved.', { exact: true }),
  ).toBeVisible()
  async function productRating() {
    return z
      .object({
        product: z.object({ ratingCount: z.number(), ratingAvg: z.number() }),
      })
      .parse(
        await (await page.request.get(`/api/products/${fixture.slug}`)).json(),
      ).product
  }
  await expect.poll(async () => (await productRating()).ratingAvg).toBe(3.75)
  await published
    .getByRole('button', { name: 'Refresh reviews', exact: true })
    .click()
  await expect(
    published
      .locator(`[data-review-id="${review.id}"]`)
      .getByText(reviewTitle, { exact: true }),
  ).toBeVisible()
  await expect(published).toContainText('from 12 reviews')
  const contexts = []
  const adminContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: page.viewportSize(),
    extraHTTPHeaders: headers(),
  })
  contexts.push(adminContext)
  try {
    const admin = await adminContext.newPage()
    await admin.goto('/admin/reviews')
    await expect(admin).toHaveURL(/\/sign-in\?returnTo=/)
    await signIn(admin, fixturesFor(info.project.name).adminEmail)
    await admin.goto('/admin/reviews')
    const moderation = admin.getByRole('region', {
      name: 'Moderation list',
      exact: true,
    })
    const first = listSchema.parse(
      await (
        await admin.request.get('/api/admin/reviews?limit=20&status=published')
      ).json(),
    )
    await expect(moderation.locator('li')).toHaveCount(20)
    expect(
      await moderation
        .locator('li')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute('data-review-id')),
        ),
    ).toEqual(first.items.map((row) => row.id))
    await admin
      .getByRole('link', { name: 'Older reviews', exact: true })
      .click()
    await expect(admin).toHaveURL(/cursor=/)
    const next = listSchema.parse(
      await (
        await admin.request.get(
          `/api/admin/reviews?status=published&limit=20&cursor=${encodeURIComponent(first.nextCursor!)}`,
        )
      ).json(),
    )
    expect(
      await moderation
        .locator('li')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute('data-review-id')),
        ),
    ).toEqual(next.items.map((row) => row.id))
    expect(
      next.items.some((row) => first.items.some((old) => old.id === row.id)),
    ).toBe(false)
    await admin
      .getByRole('link', { name: 'Show latest reviews', exact: true })
      .click()
    const card = admin.locator(`[data-review-id="${review.id}"]`)
    await expect(
      card.getByRole('link', { name: 'View product', exact: true }),
    ).toHaveAttribute('href', productPath)
    await layout(admin)
    await card.screenshot({
      path: info.outputPath('review-moderation-light.png'),
    })
    await admin.emulateMedia({ colorScheme: 'dark' })
    await layout(admin)
    await card.screenshot({
      path: info.outputPath('review-moderation-dark.png'),
    })
    await admin.route(`**/api/admin/reviews/${review.id}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'The review decision is temporarily unavailable.',
        }),
      }),
    )
    await card.getByRole('button', { name: 'Hide review', exact: true }).focus()
    await admin.keyboard.press('Enter')
    const dialog = admin.getByRole('dialog', {
      name: 'Hide review?',
      exact: true,
    })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      card.getByRole('button', { name: 'Hide review', exact: true }),
    ).toBeFocused()
    await admin.keyboard.press('Enter')
    await dialog
      .getByRole('button', { name: 'Hide review', exact: true })
      .click()
    await expect(card.getByRole('alert')).toContainText(
      'temporarily unavailable',
    )
    await admin.unroute(`**/api/admin/reviews/${review.id}`)
    await card.getByRole('button', { name: 'Hide review', exact: true }).click()
    await dialog
      .getByRole('button', { name: 'Hide review', exact: true })
      .click()
    await expect(card).toHaveCount(0)
    await admin
      .getByRole('link', { name: 'Hidden reviews', exact: true })
      .click()
    await expect(card.getByText(reviewTitle, { exact: true })).toBeVisible()
    await expect.poll(async () => (await productRating()).ratingCount).toBe(11)
    await own
      .getByRole('button', { name: 'Reload your review', exact: true })
      .click()
    await expect(
      own.getByText('An administrator has hidden your review.', {
        exact: false,
      }),
    ).toBeVisible()
    const hiddenTitle = `Edited while hidden ${info.project.name}`
    await title.fill(hiddenTitle)
    await rating.selectOption('2')
    await own
      .getByRole('button', { name: 'Save review changes', exact: true })
      .click()
    await expect(
      own.getByText('Your review was saved.', { exact: true }),
    ).toBeVisible()
    expect(
      reviewSchema.parse(await (await page.request.get(`${api}/mine`)).json())
        .review.status,
    ).toBe('hidden')
    expect((await productRating()).ratingCount).toBe(11)
    expect((await productRating()).ratingAvg).toBe(4)
    await published
      .getByRole('button', { name: 'Refresh reviews', exact: true })
      .click()
    await expect(
      published.locator(`[data-review-id="${review.id}"]`),
    ).toHaveCount(0)
    await admin
      .getByRole('button', { name: 'Refresh reviews', exact: true })
      .click()
    await expect(card.getByText(hiddenTitle, { exact: true })).toBeVisible()
    await card
      .getByRole('button', { name: 'Publish review again', exact: true })
      .click()
    await admin
      .getByRole('dialog', { name: 'Publish review again?', exact: true })
      .getByRole('button', { name: 'Publish review again', exact: true })
      .click()
    await expect(card).toHaveCount(0)
    await expect(
      admin.getByRole('heading', { name: 'No hidden reviews', exact: true }),
    ).toBeVisible()
    await expect.poll(async () => (await productRating()).ratingCount).toBe(12)
    await published
      .getByRole('button', { name: 'Refresh reviews', exact: true })
      .click()
    await expect(
      published
        .locator(`[data-review-id="${review.id}"]`)
        .getByText(hiddenTitle, { exact: true }),
    ).toBeVisible()
    await own
      .getByRole('button', { name: 'Reload your review', exact: true })
      .click()
    await expect(
      own.getByText('An administrator has hidden your review.', {
        exact: false,
      }),
    ).toHaveCount(0)
    await layout(page)
    await own.screenshot({ path: info.outputPath('buyer-review-light.png') })
    await page.emulateMedia({ colorScheme: 'dark' })
    await layout(page)
    await own.screenshot({ path: info.outputPath('buyer-review-dark.png') })
    expect((await page.request.get('/api/admin/reviews')).status()).toBe(403)
    expect(
      (
        await page.request.patch(`/api/admin/reviews/${review.id}`, {
          data: { status: 'hidden' },
        })
      ).status(),
    ).toBe(403)
    await admin.goto('/admin/reviews?status=wrong')
    await expect(
      admin
        .getByRole('alert')
        .filter({ hasText: 'Reviews could not be shown' }),
    ).toContainText('status must be published or hidden')
    await admin
      .getByRole('link', { name: 'Show published reviews', exact: true })
      .click()
    await admin.goto('/admin/reviews?cursor=invalid')
    await expect(
      admin
        .getByRole('alert')
        .filter({ hasText: 'Reviews could not be shown' }),
    ).toContainText('Reviews could not be shown')
    for (const email of [null, fixturesFor(info.project.name).sellerEmail]) {
      const otherContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
        viewport: page.viewportSize(),
        extraHTTPHeaders: headers(),
      })
      contexts.push(otherContext)
      const other = await otherContext.newPage()
      await signIn(other, email ?? undefined)
      await other.goto(productPath)
      const otherOwn = other.getByRole('region', {
        name: 'Your review',
        exact: true,
      })
      if (email) {
        await expect(
          otherOwn.getByText('Only buyer accounts can write reviews.', {
            exact: false,
          }),
        ).toBeVisible()
        expect(
          (
            await other.request.post(api, {
              data: { rating: 5, authorName: 'Denied' },
            })
          ).status(),
        ).toBe(403)
        expect((await other.request.get('/api/admin/reviews')).status()).toBe(
          403,
        )
      } else {
        await expect(
          otherOwn.getByRole('button', { name: 'Publish review', exact: true }),
        ).toBeVisible()
        const unverified = reviewSchema.parse(
          await (
            await other.request.post(api, {
              data: { rating: 3, authorName: 'Another buyer' },
            })
          ).json(),
        ).review
        expect(unverified.verifiedPurchase).toBe(false)
        await otherOwn
          .getByRole('button', { name: 'Reload your review', exact: true })
          .click()
        await expect(
          otherOwn.getByText('Verified purchase', { exact: true }),
        ).toHaveCount(0)
        await expect(otherOwn.locator('#review-name')).toHaveValue(
          'Another buyer',
        )
      }
    }
    await admin.goto(productPath)
    await expect(
      admin
        .getByRole('region', { name: 'Your review', exact: true })
        .getByText('Only buyer accounts can write reviews.', { exact: false }),
    ).toBeVisible()
    expect(
      (
        await admin.request.post(api, {
          data: { rating: 5, authorName: 'Denied' },
        })
      ).status(),
    ).toBe(403)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
