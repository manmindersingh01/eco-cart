import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
const jobsSchema = z.object({
  items: z.array(z.object({ id: z.string() })),
  nextCursor: z.string().nullable(),
})
const emailsSchema = z.object({
  items: z.array(
    z.object({ id: z.number(), template: z.string(), to: z.string() }),
  ),
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
async function privateContentsAbsent(page: Page) {
  const html = await page.content()
  for (const value of [
    'PRIVATE_SIGN_IN_CODE',
    'PRIVATE_JOB_PAYLOAD',
    'PRIVATE_FAILURE_DETAIL',
    'PRIVATE_MESSAGE_SUBJECT',
  ])
    expect(html).not.toContain(value)
}
test('BW01 queues, confirmed retries, email filters, privacy and similar product cards', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  const similar = z
    .object({
      similarProducts: z.record(
        z.string(),
        z.object({
          slug: z.string(),
          candidateSlug: z.string(),
          candidateTitle: z.string(),
          emptySlug: z.string(),
        }),
      ),
    })
    .parse(JSON.parse(process.env.E2E_FIXTURES ?? '{}')).similarProducts[
    info.project.name
  ]!
  await page.goto('/admin/background-work')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  await page.goto('/admin/background-work')
  const list = page.getByRole('region', {
    name: 'Background work lists',
    exact: true,
  })
  await expect(
    list.getByText('No matching work', { exact: true }),
  ).toBeVisible()
  await page.getByText('Show queue counts', { exact: true }).click()
  const counts = page.getByRole('region', { name: 'Queue counts', exact: true })
  const response = await page.request.get('/api/admin/queues')
  const queues = z
    .object({ queues: z.array(z.object({ name: z.string() })) })
    .parse(await response.json()).queues
  await expect(counts.getByRole('heading', { level: 3 })).toHaveCount(
    queues.length,
  )
  await layout(page)
  await page.getByText('Show queue counts', { exact: true }).click()
  await list
    .getByLabel('Queue', { exact: true })
    .selectOption('catalogue.embed-product')
  await list.getByRole('button', { name: 'Apply filters', exact: true }).click()
  const first = jobsSchema.parse(
    await (
      await page.request.get(
        '/api/admin/queues/catalogue.embed-product/failed-jobs?limit=20',
      )
    ).json(),
  )
  await expect(list.locator('[data-job-id]')).toHaveCount(20)
  expect(
    await list
      .locator('[data-job-id]')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-job-id')),
      ),
  ).toEqual(first.items.map((job) => job.id))
  await privateContentsAbsent(page)
  await list.getByRole('link', { name: 'Older records', exact: true }).click()
  await expect(page).toHaveURL(/cursor=/)
  const older = jobsSchema.parse(
    await (
      await page.request.get(
        `/api/admin/queues/catalogue.embed-product/failed-jobs?limit=20&cursor=${encodeURIComponent(first.nextCursor!)}`,
      )
    ).json(),
  )
  await expect
    .poll(() =>
      list
        .locator('[data-job-id]')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute('data-job-id')),
        ),
    )
    .toEqual(older.items.map((item) => item.id))
  const olderIds = await list
    .locator('[data-job-id]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-job-id')))
  expect(olderIds.length).toBeGreaterThan(0)
  expect(
    olderIds.every((id) => !first.items.some((job) => job.id === id)),
  ).toBe(true)
  await list.getByRole('link', { name: 'Newest records', exact: true }).click()
  const job = list.locator(`[data-job-id="${first.items[0]!.id}"]`)
  const retry = job.getByRole('button', { name: 'Retry', exact: true })
  await retry.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', {
    name: 'Retry background work?',
    exact: true,
  })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(retry).toBeFocused()
  await retry.click()
  const jobResponse = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().includes(`${first.items[0]!.id}/retry`),
  )
  await dialog
    .getByRole('button', { name: 'Confirm retry', exact: true })
    .click()
  expect((await jobResponse).status()).toBe(200)
  await expect(job).toHaveCount(0)

  await list
    .getByRole('link', { name: 'Undelivered emails', exact: true })
    .click()
  await list.getByLabel('Email state', { exact: true }).selectOption('failed')
  await list.getByRole('button', { name: 'Apply filters', exact: true }).click()
  const failedEmails = emailsSchema.parse(
    await (
      await page.request.get('/api/admin/emails?state=failed&limit=20')
    ).json(),
  )
  const otp = failedEmails.items.find((email) => email.template === 'otp')!
  await expect(
    list
      .locator(`[data-email-id="${otp.id}"]`)
      .getByRole('button', { name: 'Retry', exact: true }),
  ).toHaveCount(0)
  await privateContentsAbsent(page)
  await layout(page)
  await page.screenshot({
    path: info.outputPath('background-emails-light.png'),
    fullPage: true,
  })
  const email = failedEmails.items.find((item) => item.template !== 'otp')!
  const emailRow = list.locator(`[data-email-id="${email.id}"]`)
  const emailEndpoint = `**/api/admin/emails/${email.id}/retry`
  await page.route(emailEndpoint, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'PRIVATE_FAILURE_DETAIL' }),
    }),
  )
  await emailRow.getByRole('button', { name: 'Retry', exact: true }).click()
  await dialog
    .getByRole('button', { name: 'Confirm retry', exact: true })
    .click()
  await expect(emailRow.getByRole('alert')).toContainText(
    'Refresh this list to check the current state',
  )
  await expect(
    emailRow.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeDisabled()
  await privateContentsAbsent(page)
  await page.unroute(emailEndpoint)
  await emailRow
    .getByRole('button', { name: 'Reload current state', exact: true })
    .click()
  await emailRow.getByRole('button', { name: 'Retry', exact: true }).click()
  const emailResponse = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().includes(`/emails/${email.id}/retry`),
  )
  await dialog
    .getByRole('button', { name: 'Confirm retry', exact: true })
    .click()
  expect((await emailResponse).status()).toBe(200)
  await expect(emailRow).toHaveCount(0)
  await list.getByLabel('Email state', { exact: true }).selectOption('stuck')
  await list.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(list).toContainText('State: stuck')
  const stuckEmails = emailsSchema.parse(
    await (
      await page.request.get('/api/admin/emails?state=stuck&limit=20')
    ).json(),
  )
  const stuck = stuckEmails.items[0]!
  const stuckRow = list.locator(`[data-email-id="${stuck.id}"]`)
  await stuckRow.getByRole('button', { name: 'Retry', exact: true }).click()
  const stuckResponse = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().includes(`/emails/${stuck.id}/retry`),
  )
  await dialog
    .getByRole('button', { name: 'Confirm retry', exact: true })
    .click()
  expect((await stuckResponse).status()).toBe(200)
  await expect(stuckRow).toHaveCount(0)
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await page.screenshot({
    path: info.outputPath('background-stuck-dark.png'),
    fullPage: true,
  })
  await page.goto('/admin/background-work?queue=notifications.send-sms')
  await expect(
    list.getByText(
      'Sign-in codes expire. Ask the person to request a new code.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    list.getByRole('button', { name: 'Retry', exact: true }),
  ).toHaveCount(0)
  await privateContentsAbsent(page)
  await page.goto('/admin/background-work?queue=invalid')
  await expect(
    page.getByRole('alert').filter({ hasText: 'These filters are not valid' }),
  ).toContainText('These filters are not valid')
  await page.goto('/admin/background-work?cursor=invalid')
  await expect(list.getByRole('alert')).toContainText('Work list unavailable')
  await list
    .getByRole('link', { name: 'Start list again', exact: true })
    .click()
  await expect(
    list.getByText('No matching work', { exact: true }),
  ).toBeVisible()

  const visitorContext = await browser.newContext({
    viewport: info.project.use.viewport,
    extraHTTPHeaders: headers(),
  })
  try {
    const visitor = await visitorContext.newPage()
    await visitor.goto(`/products/${similar.emptySlug}`)
    await expect(
      visitor.getByRole('region', { name: 'Similar products', exact: true }),
    ).toContainText('No similar products to show yet.')
    await expect(
      visitor.getByRole('button', { name: 'Add to cart', exact: true }),
    ).toBeEnabled()
    await visitor.goto(`/products/${similar.slug}`)
    const suggestions = visitor.getByRole('region', {
      name: 'Similar products',
      exact: true,
    })
    await expect(
      suggestions.getByRole('link', {
        name: similar.candidateTitle,
        exact: true,
      }),
    ).toHaveAttribute('href', `/products/${similar.candidateSlug}`)
    expect(await suggestions.locator('li').count()).toBeGreaterThan(0)
    await layout(visitor)
    await suggestions.screenshot({
      path: info.outputPath('similar-products-light.png'),
    })
    await visitor.emulateMedia({ colorScheme: 'dark' })
    await layout(visitor)
    const candidate = suggestions.getByRole('link', {
      name: similar.candidateTitle,
      exact: true,
    })
    await candidate.focus()
    await visitor.keyboard.press('Enter')
    await expect(visitor).toHaveURL(
      new RegExp(`/products/${similar.candidateSlug}$`),
    )
    await expect(
      visitor.getByRole('heading', {
        level: 1,
        name: similar.candidateTitle,
        exact: true,
      }),
    ).toBeVisible()
    await signIn(visitor)
    expect((await visitor.request.get('/api/admin/queues')).status()).toBe(403)
    expect((await visitor.request.get('/api/admin/emails')).status()).toBe(403)
    expect(
      (
        await visitor.request.post(`/api/admin/emails/${email.id}/retry`)
      ).status(),
    ).toBe(403)
    await visitor.goto('/admin/background-work')
    await expect(visitor).toHaveURL(/\/access-denied/)
    const sellerContext = await browser.newContext({
      extraHTTPHeaders: headers(),
    })
    try {
      const seller = await sellerContext.newPage()
      await signIn(seller, fixturesFor(info.project.name).sellerEmail)
      expect(
        (
          await seller.request.get(
            '/api/admin/queues/catalogue.embed-product/failed-jobs',
          )
        ).status(),
      ).toBe(403)
      expect(
        (
          await seller.request.post(
            `/api/admin/queues/catalogue.embed-product/failed-jobs/${first.items[0]!.id}/retry`,
          )
        ).status(),
      ).toBe(403)
      await seller.goto('/admin/background-work')
      await expect(seller).toHaveURL(/\/access-denied/)
    } finally {
      await sellerContext.close()
    }
  } finally {
    await visitorContext.close()
  }
})
