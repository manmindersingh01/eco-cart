import { z } from 'zod'
import { createTestWorkbook } from '../../../packages/core/src/testing/spreadsheets.ts'
import { test, expect, fixturesFor } from './support/test.ts'
import { signIn } from './support/auth.ts'

test('C07 C08 CSV and XLSX mapping, persisted drafts and partial errors', async ({
  page,
  checkPage,
}, info) => {
  test.setTimeout(180000)
  const { sellerEmail } = fixturesFor(info.project.name)
  await signIn(page, sellerEmail)
  for (const extension of ['csv', 'xlsx']) {
    const sku = `IMPORT-${crypto.randomUUID()}`
    const rows = [
      ['Title', 'Category', 'SKU', 'Price', 'MRP', 'Stock', 'Minimum quantity'],
      [
        'Imported bamboo bowl',
        'Browser test kitchenware',
        sku,
        '100',
        '120',
        '20',
        '10',
      ],
      [
        'Duplicate bamboo bowl',
        'Browser test kitchenware',
        sku,
        '100',
        '120',
        '20',
        '10',
      ],
      [
        'Invalid bamboo bowl',
        'Unknown category',
        `BAD-${sku}`,
        '100',
        '120',
        '20',
        '10',
      ],
    ]
    const buffer =
      extension === 'xlsx'
        ? createTestWorkbook(rows)
        : Buffer.from(rows.map((row) => row.join(',')).join('\n'))
    await page.goto('/seller/imports')
    // File injection bypasses disabled controls; wait as a user must.
    await expect(page.getByLabel('Catalogue file')).toBeEnabled()
    await page.getByLabel('Catalogue file').setInputFiles({
      name: `catalogue.${extension}`,
      mimeType:
        extension === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
      buffer,
    })
    await expect(page).toHaveURL(/\/seller\/imports\/[a-f0-9-]+$/)
    const id = page.url().split('/').at(-1)!
    await expect(
      page.getByRole('button', { name: 'Confirm mapping and import' }),
    ).toBeEnabled({ timeout: 60000 })
    await page
      .getByLabel('Minimum quantity', { exact: true })
      .selectOption('minOrderQuantity')
    const dialog = page.getByRole('dialog', {
      name: 'Confirm catalogue import?',
    })
    await page
      .getByRole('button', { name: 'Confirm mapping and import' })
      .click()
    await dialog.getByRole('button', { name: 'Start import' }).click()
    await expect(
      page.getByText('Import status: completed', { exact: true }),
    ).toBeVisible({ timeout: 60000 })
    await expect(
      page.getByText('1 imported, 2 failed, 3 total rows', { exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByText('1 imported, 2 failed, 3 total rows', { exact: true }),
    ).toBeVisible()
    const errorReport = await page.request.get(
      `/api/seller/imports/${id}/error-report`,
    )
    expect(errorReport.status()).toBe(200)
    expect(await errorReport.text()).toContain('Unknown category')
    expect(
      (
        await page.request.put(`/api/seller/imports/${id}/mapping`, {
          data: {
            columnMapping: {
              Title: 'title',
              Category: 'category',
              SKU: 'sku',
              Price: 'price',
              MRP: 'mrp',
              Stock: 'stock',
              'Minimum quantity': 'minOrderQuantity',
            },
          },
        })
      ).status(),
    ).toBe(409)
    const products = z
      .object({
        items: z.array(z.object({ id: z.string(), title: z.string() })),
      })
      .parse(
        await (
          await page.request.get('/api/seller/products?status=draft')
        ).json(),
      )
    let matching = 0
    const draftIds: string[] = []
    for (const product of products.items) {
      const detail = z
        .object({
          product: z.object({
            minOrderQuantity: z.number(),
            status: z.string(),
            variants: z.array(z.object({ sku: z.string() })),
          }),
        })
        .parse(
          await (
            await page.request.get(`/api/seller/products/${product.id}`)
          ).json(),
        ).product
      if (detail.variants.some((variant) => variant.sku === sku)) {
        matching++
        draftIds.push(product.id)
        expect(detail.minOrderQuantity).toBe(10)
        expect(detail.status).toBe('draft')
      }
    }
    expect(matching).toBe(1)
    await info.attach(`import-${extension}-proof.json`, {
      contentType: 'application/json',
      body: JSON.stringify({
        importId: id,
        sku,
        matchingDrafts: matching,
        draftIds,
        imported: 1,
        failed: 2,
        total: 3,
      }),
    })
    await checkPage()
    await page.screenshot({
      path: info.outputPath(`completed-${extension}-import.png`),
      fullPage: true,
    })
  }
})
