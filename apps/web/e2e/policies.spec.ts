import { expect, test, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { signIn } from './support/auth.ts'
import { fixturesFor } from './support/test.ts'

const slugs = [
  'terms',
  'privacy',
  'shipping',
  'returns',
  'refunds',
  'seller-agreement',
]
const headers = () => ({
  'x-forwarded-for': `198.18.${randomInt(256)}.${randomInt(1, 255)}`,
})
const markdown = `## Policy heading

Example **approved formatting**, for browser verification only.

- First point
- Second point

[Visit shop](/)

[Unsafe link](javascript:alert(1))

<script>document.documentElement.dataset.policyExecuted = 'yes'</script>
<img src=x onerror="document.documentElement.dataset.policyExecuted = 'yes'">
<iframe src="https://example.com"></iframe>

> Contact support for help.

\`\`\`
${'long-policy-example'.repeat(25)}
\`\`\`
`
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
async function safe(page: Page, region: string) {
  const content = page.getByRole(
    region === 'article' ? 'article' : 'region',
    region === 'article' ? {} : { name: region },
  )
  await expect(
    content.getByRole('heading', { name: 'Policy heading', exact: true }),
  ).toBeVisible()
  await expect(content.locator('script, iframe, img')).toHaveCount(0)
  expect(
    await content
      .locator('a')
      .evaluateAll((links) =>
        links.every(
          (link) => !/^javascript:/i.test(link.getAttribute('href') ?? ''),
        ),
      ),
  ).toBe(true)
  expect(
    await page.evaluate(() => document.documentElement.dataset.policyExecuted),
  ).toBeUndefined()
}
test('PL01 public policies, safe preview, draft privacy and publish invalidation', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  await page.context().setExtraHTTPHeaders(headers())
  await page.goto('/admin/content')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/)
  await signIn(page, fixturesFor(info.project.name).adminEmail)
  await page.goto('/admin/content')
  await expect(page.getByRole('link', { name: /^Edit / })).toHaveCount(6)
  await layout(page)
  const publicContext = await browser.newContext({
    viewport: info.project.use.viewport,
    extraHTTPHeaders: headers(),
  })
  const visitor = await publicContext.newPage()
  try {
    for (const slug of slugs) {
      const response = await page.request.put(`/api/admin/content/${slug}`, {
        data: {
          title: `Example ${slug}`,
          bodyMarkdown: markdown,
          status: 'published',
        },
      })
      expect(response.status()).toBe(200)
      await visitor.goto(`/policies/${slug}`)
      await expect(
        visitor.getByRole('heading', { name: `Example ${slug}`, exact: true }),
      ).toBeVisible()
    }
    await safe(visitor, 'article')
    const footer = visitor.getByRole('contentinfo')
    await expect(
      footer
        .getByRole('navigation', { name: 'Policies', exact: true })
        .getByRole('link'),
    ).toHaveCount(6)
    await expect(
      footer.getByRole('region', { name: 'Company details', exact: true }),
    ).toBeVisible()
    await expect(footer).toContainText('GSTIN:')
    await expect(footer).toContainText('Grievance officer')
    await layout(visitor)
    await visitor.screenshot({
      path: info.outputPath('public-policy-light.png'),
      fullPage: true,
    })

    await page.goto('/admin/content/terms')
    const form = page.getByRole('form', { name: 'Policy editor', exact: true })
    await expect(form.getByLabel('Page title', { exact: false })).toHaveValue(
      'Example terms',
    )
    await form.getByLabel('Page title', { exact: false }).fill('Updated terms')
    await form
      .getByLabel('Policy text (Markdown)', { exact: true })
      .fill(markdown + '\nPrivate draft text.')
    await form.getByLabel('Save as', { exact: true }).selectOption('draft')
    await form
      .getByRole('button', { name: 'Show preview', exact: true })
      .focus()
    await page.keyboard.press('Enter')
    await safe(page, 'Policy preview')
    await layout(page)

    await page.route('**/api/admin/content/terms', async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Those page details are not valid',
            issues: ['Please check the policy text.'],
          }),
        })
      else await route.continue()
    })
    await form.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText(
      'Please check the policy text.',
    )
    await expect(form.getByLabel('Page title', { exact: false })).toHaveValue(
      'Updated terms',
    )
    await expect(
      form.getByLabel('Policy text (Markdown)', { exact: true }),
    ).toHaveValue(markdown + '\nPrivate draft text.')
    await page.unroute('**/api/admin/content/terms')
    await form.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(
      form.getByText('Page saved as draft.', { exact: false }),
    ).toBeVisible()
    await expect
      .poll(async () =>
        (await visitor.request.get('/api/content/terms')).status(),
      )
      .toBe(404)
    await visitor.goto('/policies/terms')
    await expect(
      visitor.getByRole('heading', {
        name: 'This page is not available',
        exact: true,
      }),
    ).toBeVisible()
    await page.reload()
    await expect(form.getByLabel('Save as', { exact: true })).toHaveValue(
      'draft',
    )
    await form
      .getByLabel('Policy text (Markdown)', { exact: true })
      .fill(markdown + '\nPublished revision.')
    await form.getByLabel('Save as', { exact: true }).selectOption('published')
    await form
      .getByRole('button', { name: 'Publish page', exact: true })
      .click()
    await expect(
      form.getByText('Page saved as published.', { exact: false }),
    ).toBeVisible()
    await expect
      .poll(async () => {
        const response = await visitor.request.get('/api/content/terms')
        return response.ok()
          ? (await response.text()).includes('Published revision.')
          : false
      })
      .toBe(true)
    await visitor.goto('/policies/terms')
    await expect(
      visitor.getByRole('heading', { name: 'Updated terms', exact: true }),
    ).toBeVisible()
    await expect(visitor.getByRole('article')).toContainText(
      'Published revision.',
    )
    await expect(visitor.getByRole('article')).not.toContainText(
      'Private draft text.',
    )
    await safe(visitor, 'article')
    await visitor.emulateMedia({ colorScheme: 'dark' })
    await layout(visitor)
    await page.emulateMedia({ colorScheme: 'dark' })
    await form
      .getByRole('button', { name: 'Show preview', exact: true })
      .click()
    await layout(page)
    await page
      .getByRole('region', { name: 'Policy preview' })
      .screenshot({ path: info.outputPath('policy-preview-dark.png') })
    await visitor.screenshot({
      path: info.outputPath('public-policy-dark.png'),
      fullPage: true,
    })
    await visitor.goto('/policies/not-a-policy')
    await expect(
      visitor.getByRole('heading', {
        name: 'This page is not available',
        exact: true,
      }),
    ).toBeVisible()

    await signIn(visitor)
    expect((await visitor.request.get('/api/admin/content')).status()).toBe(403)
    expect(
      (
        await visitor.request.put('/api/admin/content/terms', {
          data: { title: 'Denied', bodyMarkdown: 'No', status: 'published' },
        })
      ).status(),
    ).toBe(403)
    await visitor.goto('/admin/content/terms')
    await expect(visitor).toHaveURL(/\/access-denied/)
    const sellerContext = await browser.newContext({
      extraHTTPHeaders: headers(),
    })
    try {
      const seller = await sellerContext.newPage()
      await signIn(seller, fixturesFor(info.project.name).sellerEmail)
      expect(
        (await seller.request.get('/api/admin/content/terms')).status(),
      ).toBe(403)
      expect(
        (
          await seller.request.put('/api/admin/content/terms', {
            data: { title: 'Denied', bodyMarkdown: 'No', status: 'draft' },
          })
        ).status(),
      ).toBe(403)
      await seller.goto('/admin/content')
      await expect(seller).toHaveURL(/\/access-denied/)
    } finally {
      await sellerContext.close()
    }
  } finally {
    await publicContext.close()
  }
})
