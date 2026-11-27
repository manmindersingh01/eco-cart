import { test, expect, fixturesFor } from './support/test.ts'
import { signIn } from './support/auth.ts'

test('PN01 portal overviews reach every tool with keyboard and role protection', async ({
  page,
  checkPage,
}, info) => {
  test.setTimeout(240000)
  const fixtures = fixturesFor(info.project.name)
  const areas = [
    {
      area: 'admin',
      name: 'Administrator portal',
      email: fixtures.adminEmail,
      paths: [
        'orders',
        'returns',
        'reviews',
        'coupons',
        'content',
        'background-work',
        'ai',
        'search-gaps',
        'payouts',
        'settings',
        'sellers',
        'seller-documents',
        'categories',
        'brands',
        'moderation',
      ],
    },
    {
      area: 'seller',
      name: 'Seller portal',
      email: fixtures.sellerEmail,
      paths: [
        'profile',
        'documents',
        'products',
        'orders',
        'returns',
        'earnings',
        'invoices',
        'imports',
      ],
    },
  ]
  for (const { area, name, email, paths } of areas) {
    await page.context().clearCookies()
    await signIn(page, email)
    await page.goto(`/${area}`)
    const tools = page.getByRole('region', {
      name: 'Available tools',
      exact: true,
    })
    const nav = page.getByRole('navigation', {
      name: `${name} navigation`,
      exact: true,
    })
    const expected = paths.map((path) => `/${area}/${path}`)
    await expect(tools.getByRole('link')).toHaveCount(expected.length)
    expect(
      await tools
        .getByRole('link')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(expected)
    expect(
      await nav
        .getByRole('link')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual([`/${area}`, ...expected])
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await expect(async () => checkPage()).toPass({ timeout: 10000 })
      await page.screenshot({
        path: info.outputPath(`${area}-${colorScheme}.png`),
        fullPage: true,
      })
    }
    // Tabbing from the first menu item must reach even the last phone item.
    const navLinks = nav.getByRole('link')
    await navLinks.first().focus()
    for (let index = 1; index <= paths.length; index++) {
      await page.keyboard.press('Tab')
      await expect(navLinks.nth(index)).toBeFocused()
    }
    await expect(navLinks.last()).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`${expected.at(-1)}$`))
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Visit actual pages, rather than accepting a matching href as proof.
    for (const href of expected) {
      await page.goto(`/${area}`)
      await tools.locator(`a[href="${href}"]`).click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(
        page.getByText('This page could not be found.', { exact: true }),
      ).toHaveCount(0)
    }
  }
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/access-denied/)
  await page.context().clearCookies()
  await signIn(page)
  for (const area of ['admin', 'seller']) {
    await page.goto(`/${area}`)
    await expect(page).toHaveURL(/\/access-denied/)
  }
  await page.context().clearCookies()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/sign-in/)
})
