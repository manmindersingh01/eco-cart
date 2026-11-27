import { expect, test, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
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
const askedSchema = z.object({
  question: z.string(),
  productIds: z.array(z.string()),
  history: z.array(
    z.object({ from: z.enum(['shopper', 'assistant']), text: z.string() }),
  ),
})
test('AR01 bounded assistant conversation and real administrator reports', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  const fixtures = z
    .object({
      similarProducts: z.record(z.string(), z.object({ slug: z.string() })),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}'))
  const slug = fixtures.similarProducts[info.project.name]!.slug
  const product = z
    .object({ product: z.object({ id: z.string() }) })
    .parse(
      await (await page.request.get(`/api/products/${slug}`)).json(),
    ).product
  const cards = z
    .object({
      items: z.array(
        z
          .object({ id: z.string(), title: z.string(), slug: z.string() })
          .passthrough(),
      ),
    })
    .parse(
      await (await page.request.get('/api/search?q=bamboo&limit=2')).json(),
    ).items
  expect(cards).toHaveLength(2)
  await page.goto(`/products/${slug}`)
  await page.getByText('Shopping assistant', { exact: true }).focus()
  await page.keyboard.press('Enter')
  const form = page.getByRole('form', {
    name: 'Ask the shopping assistant',
    exact: true,
  })
  const question = form.getByLabel('Your shopping question', { exact: false })
  await question.fill('Compare these products')
  await form.getByRole('button', { name: 'Ask assistant', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Assistant could not answer' }),
  ).toContainText('unavailable right now')
  await expect(question).toHaveValue('Compare these products')
  await expect(
    page.getByRole('button', { name: 'Add to cart', exact: true }),
  ).toBeEnabled()
  const requests: z.output<typeof askedSchema>[] = []
  let limited = false
  await page.route('**/api/assistant', async (route) => {
    requests.push(askedSchema.parse(route.request().postDataJSON()))
    if (limited) {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'PRIVATE_PROVIDER_DETAIL' }),
      })
      return
    }
    const declined = requests.length === 2
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: declined
          ? 'The catalogue does not say.'
          : '<script>unsafe()</script> These are catalogue facts.',
        declined,
        productIds: ['invented-product-id'],
        products: declined ? [] : cards,
        comparison:
          requests.length === 1
            ? {
                products: cards,
                points: [{ aspect: 'Price', first: '₹500', second: '₹500' }],
              }
            : null,
      }),
    })
  })
  await form.getByRole('button', { name: 'Ask assistant', exact: true }).click()
  const conversation = page.getByRole('region', {
    name: 'Assistant conversation',
    exact: true,
  })
  const cited = page.getByRole('region', {
    name: 'Products cited by the assistant',
    exact: true,
  })
  await expect(conversation).toContainText('<script>unsafe()</script>')
  await expect(conversation.locator('script')).toHaveCount(0)
  await expect(cited.getByRole('link')).toHaveCount(2)
  await expect(page.locator('a[href*="invented-product-id"]')).toHaveCount(0)
  expect(requests[0]!.productIds).toEqual([product.id])
  await expect(
    page.getByRole('region', { name: 'Product comparison', exact: true }),
  ).toContainText(cards[0]!.title)
  await layout(page)
  await page.screenshot({
    path: info.outputPath('assistant-light.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await page.screenshot({
    path: info.outputPath('assistant-dark.png'),
    fullPage: true,
  })
  await question.fill('Are these certified?')
  await form.getByRole('button', { name: 'Ask assistant', exact: true }).click()
  await expect(conversation).toContainText(
    'could not answer from the available product facts',
  )
  await expect(cited).toHaveCount(0)
  for (let index = 0; index < 3; index++) {
    await question.fill(`Follow-up ${index}`)
    await form
      .getByRole('button', { name: 'Ask assistant', exact: true })
      .click()
    await expect(question).toHaveValue('')
  }
  expect(requests.at(-1)!.history).toHaveLength(6)
  expect(
    requests.every(
      (request) =>
        request.history.length <= 6 && request.productIds.length <= 5,
    ),
  ).toBe(true)
  await expect(conversation).not.toContainText('Compare these products')
  limited = true
  await question.fill('Question kept after a limit')
  await form.getByRole('button', { name: 'Ask assistant', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Assistant could not answer' }),
  ).toContainText('question limit')
  await expect(question).toHaveValue('Question kept after a limit')
  expect(await page.content()).not.toContain('PRIVATE_PROVIDER_DETAIL')
  await form
    .getByRole('button', { name: 'Clear conversation', exact: true })
    .click()
  await expect(conversation).toHaveCount(0)
  await page.unroute('**/api/assistant')
  await page.goto('/search?q=bamboo&limit=2')
  await page.getByText('Shopping assistant', { exact: true }).click()
  await expect(form).toBeVisible()
  await question.fill('Ask about these search results')
  const searchAnswer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/assistant') &&
      response.request().method() === 'POST',
  )
  await form.getByRole('button', { name: 'Ask assistant', exact: true }).click()
  const searchResponse = await searchAnswer
  expect(
    askedSchema.parse(searchResponse.request().postDataJSON()).productIds,
  ).toEqual(cards.map((card) => card.id))

  const adminContext = await browser.newContext({
    viewport: info.project.use.viewport,
    extraHTTPHeaders: headers(),
  })
  try {
    const admin = await adminContext.newPage()
    await signIn(admin, fixturesFor(info.project.name).adminEmail)
    await admin.goto('/admin/ai?from=2026-01-02&to=2026-01-02')
    const entries = admin.getByRole('region', {
      name: 'AI usage entries',
      exact: true,
    })
    await expect(entries).toContainText('USD 1.234567')
    await expect(entries).toContainText('Not reported')
    await expect(entries.locator('li')).toHaveCount(2)
    const report = z
      .object({
        today: z.object({
          platformCalls: z.number(),
          platformLimit: z.number(),
        }),
        lines: z.array(
          z.object({
            feature: z.string(),
            calls: z.number(),
            failedCalls: z.number(),
            costMicroUsd: z.number().nullable(),
          }),
        ),
      })
      .parse(
        await (
          await admin.request.get(
            '/api/admin/ai/usage?from=2026-01-02&to=2026-01-02',
          )
        ).json(),
      )
    expect(
      report.lines.find((line) => line.feature === 'listing_draft'),
    ).toMatchObject({ calls: 2, failedCalls: 1, costMicroUsd: 1234567 })
    expect(report.today.platformCalls).toBe(1)
    await expect(
      admin.getByText(
        `${report.today.platformCalls.toLocaleString('en-IN')} / ${report.today.platformLimit.toLocaleString('en-IN')} calls`,
        { exact: true },
      ),
    ).toBeVisible()
    await layout(admin)
    await admin.screenshot({
      path: info.outputPath('ai-usage-light.png'),
      fullPage: true,
    })
    await admin.emulateMedia({ colorScheme: 'dark' })
    await layout(admin)
    await admin
      .getByLabel('From (India date)', { exact: true })
      .fill('2099-01-01')
    await admin
      .getByLabel('To (India date)', { exact: true })
      .fill('2099-01-01')
    await admin
      .getByRole('button', { name: 'Apply dates', exact: true })
      .click()
    await expect(entries).toContainText('No AI calls in this range')
    await admin.goto('/admin/ai?from=2026-01-03&to=2026-01-02')
    await expect(
      admin
        .getByRole('alert')
        .filter({ hasText: 'AI usage could not be shown' }),
    ).toContainText('From no later than To')
    await admin.goto('/admin/search-gaps')
    const gaps = admin.getByRole('region', {
      name: 'Zero-result queries',
      exact: true,
    })
    await expect(gaps).toContainText('No search gaps in this period')
    await admin.getByLabel('Past days', { exact: true }).fill('90')
    await admin
      .getByRole('button', { name: 'Apply period', exact: true })
      .click()
    await expect(gaps).toContainText('fixture missing product')
    await expect(gaps).toContainText('2 searches')
    await layout(admin)
    await admin.screenshot({
      path: info.outputPath('search-gaps-dark.png'),
      fullPage: true,
    })
    await admin.goto('/admin/search-gaps?days=91')
    await expect(
      admin
        .getByRole('alert')
        .filter({ hasText: 'Search gaps could not be shown' }),
    ).toContainText('1 to 90')
  } finally {
    await adminContext.close()
  }
  await signIn(page)
  expect((await page.request.get('/api/admin/ai/usage')).status()).toBe(403)
  expect((await page.request.get('/api/admin/search/gaps')).status()).toBe(403)
  await page.goto('/admin/ai')
  await expect(page).toHaveURL(/\/access-denied/)
  const sellerContext = await browser.newContext({
    extraHTTPHeaders: headers(),
  })
  try {
    const seller = await sellerContext.newPage()
    await signIn(seller, fixturesFor(info.project.name).sellerEmail)
    expect((await seller.request.get('/api/admin/ai/usage')).status()).toBe(403)
    expect((await seller.request.get('/api/admin/search/gaps')).status()).toBe(
      403,
    )
    await seller.goto('/admin/search-gaps')
    await expect(seller).toHaveURL(/\/access-denied/)
  } finally {
    await sellerContext.close()
  }
})
