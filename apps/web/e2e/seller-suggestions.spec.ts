import { expect, test, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'
import { createCatalogueProduct, ownProduct } from './support/catalogue.ts'

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
test('SG01 selected listing fields and late import suggestions preserve manual work', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  const { sellerEmail, otherSellerEmail, categoryId } = fixturesFor(
    info.project.name,
  )
  await signIn(page, sellerEmail)
  const product = await createCatalogueProduct(page, categoryId)
  await page.goto(`/seller/products/${product.id}`)
  const panel = page.getByRole('region', {
    name: 'AI listing suggestions',
    exact: true,
  })
  const request = panel.getByRole('button', {
    name: 'Request listing suggestions',
    exact: true,
  })
  await expect(request).toBeDisabled()
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
  await expect(request).toBeEnabled({ timeout: 60000 })
  await page.locator('#edit-product-title').fill('My unsaved seller title')
  await page
    .locator('#edit-product-description')
    .fill('My unsaved seller description')
  await request.click()
  await expect(panel).toContainText('AI listing suggestions are unavailable')
  await expect(page.locator('#edit-product-title')).toHaveValue(
    'My unsaved seller title',
  )
  await expect(page.locator('#edit-product-description')).toHaveValue(
    'My unsaved seller description',
  )
  const draftId = randomUUID()
  const createdAt = new Date().toISOString()
  const suggestion = {
    title: 'Suggested bamboo bowl',
    description: 'Suggested description <script>unsafe()</script>',
    highlights: ['Reusable bamboo bowl'],
    attributes: { Material: 'Bamboo' },
  }
  let finishDraft = false
  let draftReads = 0
  await page.route('**/api/seller/listing-drafts', (route) =>
    route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        draft: {
          id: draftId,
          status: 'queued',
          suggestion: null,
          error: null,
          createdAt,
        },
      }),
    }),
  )
  await page.route(`**/api/seller/listing-drafts/${draftId}`, (route) => {
    draftReads++
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        draft: {
          id: draftId,
          status: finishDraft ? 'succeeded' : 'running',
          suggestion: finishDraft ? suggestion : null,
          error: null,
          createdAt,
        },
      }),
    })
  })
  await request.click()
  await expect(panel).toContainText('Listing suggestions: queued')
  await page
    .locator('#edit-product-description')
    .fill('Edited while suggestions were running')
  await expect.poll(() => draftReads).toBeGreaterThan(0)
  finishDraft = true
  await expect(
    panel.getByLabel('Use suggested Description', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('#edit-product-description')).toHaveValue(
    'Edited while suggestions were running',
  )
  await expect(
    panel.getByLabel('Use suggested Title', { exact: true }),
  ).not.toBeChecked()
  await expect(
    panel.getByRole('button', {
      name: 'Copy selected suggestions to form',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(panel.locator('script')).toHaveCount(0)
  await layout(page)
  await panel.screenshot({
    path: info.outputPath('listing-suggestions-light.png'),
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await panel.screenshot({
    path: info.outputPath('listing-suggestions-dark.png'),
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await panel.getByLabel('Use suggested Description', { exact: true }).check()
  await panel.getByLabel('Use suggested Attributes', { exact: true }).check()
  const copy = panel.getByRole('button', {
    name: 'Copy selected suggestions to form',
    exact: true,
  })
  await copy.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#edit-product-description')).toHaveValue(
    suggestion.description,
  )
  await expect(page.locator('#edit-product-title')).toHaveValue(
    'My unsaved seller title',
  )
  expect((await ownProduct(page, product.id)).description).toBe(
    product.description,
  )
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/seller/products/${product.id}`),
  )
  await page
    .getByRole('button', { name: 'Save listing details', exact: true })
    .click()
  expect((await saved).status()).toBe(200)
  await expect
    .poll(async () => (await ownProduct(page, product.id)).description)
    .toBe(suggestion.description)
  expect((await ownProduct(page, product.id)).status).toBe('draft')
  await page.reload()
  await expect(page.locator('#edit-product-description')).toHaveValue(
    suggestion.description,
  )
  await expect(page.locator('#edit-product-title')).toHaveValue(
    'My unsaved seller title',
  )
  await page.unroute('**/api/seller/listing-drafts')
  await page.unroute(`**/api/seller/listing-drafts/${draftId}`)
  await page.route('**/api/seller/listing-drafts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        draft: {
          id: randomUUID(),
          status: 'failed',
          suggestion: null,
          error: 'PRIVATE_PROVIDER_DETAIL',
          createdAt,
        },
      }),
    }),
  )
  await request.click()
  await expect(panel).toContainText('Suggestions could not be made')
  expect(await page.content()).not.toContain('PRIVATE_PROVIDER_DETAIL')
  await expect(page.locator('#edit-product-description')).toBeEnabled()

  const sku = `AI-IMPORT-${randomUUID()}`
  await page.goto('/seller/imports')
  await expect(page.getByLabel('Catalogue file', { exact: true })).toBeEnabled()
  await page.getByLabel('Catalogue file', { exact: true }).setInputFiles({
    name: 'suggestions.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `Title,Category,SKU,Price,MRP,Stock,Odd A,Odd B\nSuggestion import bowl,Browser test kitchenware,${sku},100,120,5,Manual description,First highlight\n`,
    ),
  })
  await expect(page).toHaveURL(/\/seller\/imports\/[a-f0-9-]+$/)
  const importId = page.url().split('/').at(-1)!
  await expect(
    page.getByRole('button', {
      name: 'Confirm mapping and import',
      exact: true,
    }),
  ).toBeEnabled({ timeout: 60000 })
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('title')
  await page.getByLabel('Odd A', { exact: true }).selectOption('description')
  const realImport = z
    .object({
      import: z
        .object({
          suggestedMapping: z.record(z.string(), z.unknown()).nullable(),
          status: z.string(),
        })
        .passthrough(),
    })
    .parse(
      await (await page.request.get(`/api/seller/imports/${importId}`)).json(),
    ).import
  let finishMapping = false
  let mappingReads = 0
  const importRoute = `**/api/seller/imports/${importId}`
  await page.route(importRoute, (route) => {
    mappingReads++
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        import: {
          ...realImport,
          suggestionPending: !finishMapping,
          suggestedMapping: {
            ...realImport.suggestedMapping,
            ...(finishMapping
              ? {
                  'Odd A': {
                    field: 'highlights',
                    source: 'ai',
                    confidence: 0.9,
                  },
                  'Odd B': {
                    field: 'highlights',
                    source: 'ai',
                    confidence: 0.85,
                  },
                }
              : {}),
          },
        },
      }),
    })
  })
  await page
    .getByRole('button', { name: 'Refresh import', exact: true })
    .click()
  await expect(
    page.getByText('AI suggestions are being checked', { exact: true }),
  ).toBeVisible()
  await page.getByLabel('Odd A', { exact: true }).selectOption('description')
  await expect.poll(() => mappingReads).toBeGreaterThan(1)
  finishMapping = true
  await expect(
    page.getByRole('button', {
      name: 'Use AI suggestion for Odd A',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByLabel('Odd A', { exact: true })).toHaveValue(
    'description',
  )
  await expect(page.getByLabel('Odd B', { exact: true })).toHaveValue('')
  await page
    .getByRole('button', { name: 'Use AI suggestion for Odd B', exact: true })
    .click()
  await expect(page.getByLabel('Odd B', { exact: true })).toHaveValue(
    'highlights',
  )
  await expect(page.getByLabel('Odd A', { exact: true })).toHaveValue(
    'description',
  )
  await expect(
    page.getByText('AI suggestions are being checked', { exact: true }),
  ).toHaveCount(0)
  await layout(page)
  await page.screenshot({
    path: info.outputPath('import-suggestions-light.png'),
    fullPage: true,
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await page.screenshot({
    path: info.outputPath('import-suggestions-dark.png'),
    fullPage: true,
  })
  await page.unroute(importRoute)
  const confirm = page.getByRole('button', {
    name: 'Confirm mapping and import',
    exact: true,
  })
  await confirm.click()
  const dialog = page.getByRole('dialog', {
    name: 'Confirm catalogue import?',
    exact: true,
  })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirm).toBeFocused()
  await confirm.click()
  const mappingResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/api/seller/imports/${importId}/mapping`),
  )
  await dialog
    .getByRole('button', { name: 'Start import', exact: true })
    .click()
  const mappingWrite = await mappingResponse
  expect(mappingWrite.status()).toBe(202)
  expect(mappingWrite.request().postDataJSON()).toMatchObject({
    columnMapping: { 'Odd A': 'description', 'Odd B': 'highlights' },
  })
  await expect(
    page.getByText('Import status: completed', { exact: true }),
  ).toBeVisible({ timeout: 60000 })
  const created = z
    .object({
      items: z.array(
        z.object({ id: z.string(), title: z.string(), status: z.string() }),
      ),
    })
    .parse(
      await (
        await page.request.get('/api/seller/products?status=draft&limit=100')
      ).json(),
    )
    .items.find((item) => item.title === 'Suggestion import bowl')!
  const imported = await ownProduct(page, created.id)
  expect(imported.description).toBe('Manual description')
  expect(imported.status).toBe('draft')

  const otherContext = await browser.newContext({ extraHTTPHeaders: headers() })
  try {
    const other = await otherContext.newPage()
    await signIn(other, otherSellerEmail)
    expect(
      (await other.request.get(`/api/seller/products/${product.id}`)).status(),
    ).toBe(404)
    expect(
      (await other.request.get(`/api/seller/imports/${importId}`)).status(),
    ).toBe(404)
  } finally {
    await otherContext.close()
  }
  const buyerContext = await browser.newContext({ extraHTTPHeaders: headers() })
  try {
    const buyer = await buyerContext.newPage()
    await signIn(buyer)
    expect(
      (
        await buyer.request.post('/api/seller/listing-drafts', {
          data: { productId: product.id },
        })
      ).status(),
    ).toBe(403)
    expect(
      (await buyer.request.get(`/api/seller/imports/${importId}`)).status(),
    ).toBe(403)
  } finally {
    await buyerContext.close()
  }
})
