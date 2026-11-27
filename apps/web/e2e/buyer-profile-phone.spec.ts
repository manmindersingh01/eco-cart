import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { deliveredCode, signIn } from './support/auth.ts'
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

test('BP01 phone codes and buyer name persist without exposing placeholder email', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  const phone = `+919${randomInt(100000000, 1000000000)}`
  await page.goto('/sign-in?returnTo=%2Faccount')
  const phoneOption = page.getByRole('button', {
    name: 'Sign in with phone',
    exact: true,
  })
  await expect(phoneOption).toBeEnabled()
  await phoneOption.focus()
  await page.keyboard.press('Enter')
  const mobile = page.getByRole('textbox', {
    name: 'Mobile number',
    exact: true,
  })
  await expect(mobile).toBeFocused()
  await mobile.fill('+14155550100')
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sign-in failed' }),
  ).toContainText('Indian mobile number')
  await mobile.fill(phone.slice(3))
  const sendPath = '**/api/auth/phone-number/send-otp'
  await page.route(sendPath, (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Rate limited',
        code: 'TOO_MANY_REQUESTS',
      }),
    }),
  )
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sign-in failed' }),
  ).toContainText('Too many attempts. Wait a minute')
  await expect(mobile).toHaveValue(phone.slice(3))
  await page.unroute(sendPath)
  await layout(page)
  await page
    .getByRole('main')
    .screenshot({ path: info.outputPath('phone-sign-in-light.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await layout(page)
  await page
    .getByRole('main')
    .screenshot({ path: info.outputPath('phone-sign-in-dark.png') })
  const since = Date.now()
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click()
  const otp = page.getByRole('textbox', { name: 'Six-digit code', exact: true })
  await expect(otp).toBeFocused()
  await expect(page.getByText(phone, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Resend in/ })).toBeDisabled()
  const code = await deliveredCode(`${phone.slice(1)}@sms.mailpit.test`, since)
  const verifyPath = '**/api/auth/phone-number/verify'
  await page.route(verifyPath, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'OTP expired', code: 'OTP_EXPIRED' }),
    }),
  )
  await otp.fill(code)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sign-in failed' }),
  ).toContainText('expired. Request a new code')
  await page.unroute(verifyPath)
  await otp.fill(code === '000000' ? '111111' : '000000')
  const refused = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/phone-number/verify' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await refused).status()).toBe(400)
  await expect(
    page.getByRole('alert').filter({ hasText: 'Sign-in failed' }),
  ).toContainText('invalid')
  await layout(page)
  await otp.fill(code)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  const me = z
    .object({
      name: z.string(),
      email: z.null(),
      phoneNumber: z.string(),
      role: z.literal('buyer'),
    })
    .parse(await (await page.request.get('/api/me', { maxRetries: 2 })).json())
  expect(me.phoneNumber).toBe(phone)
  expect(await page.content()).not.toContain('@phone.ecokart.invalid')
  await expect(
    page.getByText('No email address added', { exact: true }),
  ).toBeVisible()
  const name = page.getByRole('textbox', { name: 'Your name', exact: true })
  await name.fill('   ')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Name could not be saved' }),
  ).toContainText('Enter your name')
  const displayName = `Asha Mobile ${info.project.name}`
  await name.fill(` ${displayName} `)
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/update-user' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Save name', exact: true }).focus()
  await page.keyboard.press('Enter')
  const result = await saved
  expect(result.status()).toBe(200)
  expect(result.request().postDataJSON()).toEqual({ name: displayName })
  await expect(
    page.getByText('Your name was saved.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('banner').getByText(displayName, { exact: true }),
  ).toHaveText(displayName)
  await page.reload()
  await expect(name).toHaveValue(displayName)
  expect(await page.content()).not.toContain('@phone.ecokart.invalid')
  await layout(page)
  await page
    .getByRole('main')
    .screenshot({ path: info.outputPath('buyer-profile-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  await layout(page)
  await page
    .getByRole('main')
    .screenshot({ path: info.outputPath('buyer-profile-light.png') })
  await page
    .getByRole('navigation', { name: 'Your account', exact: true })
    .getByRole('link', { name: 'Orders', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Your account', exact: true })
    .getByRole('link', { name: 'Profile', exact: true })
    .click()
  await expect(name).toHaveValue(displayName)
})

test('BP02 email sign-in, profile session failure and role restrictions', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  await page.context().setExtraHTTPHeaders(headers())
  await page.goto('/account')
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Faccount/)
  const account = await signIn(page)
  await page.goto('/account')
  const name = page.getByRole('textbox', { name: 'Your name', exact: true })
  await name.fill('Email Buyer')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(
    page.getByText('Your name was saved.', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(name).toHaveValue('Email Buyer')
  await page.context().clearCookies()
  await name.fill('Unsaved name')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Name could not be saved' }),
  ).toContainText('Your session has ended')
  await expect(name).toHaveValue('Unsaved name')
  await page.getByRole('link', { name: 'Sign in again', exact: true }).click()
  await expect(page).toHaveURL(/returnTo=%2Faccount/)
  await page.getByLabel('Email address').fill(account.email)
  const since = Date.now()
  await page.getByRole('button', { name: 'Send sign-in code' }).click()
  await page
    .getByLabel('Six-digit code')
    .fill(await deliveredCode(account.email, since))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(name).toHaveValue('Email Buyer')
  const otherContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: headers(),
  })
  try {
    const other = await otherContext.newPage()
    for (const email of [
      fixturesFor(info.project.name).adminEmail,
      fixturesFor(info.project.name).sellerEmail,
    ]) {
      await otherContext.clearCookies()
      await signIn(other, email)
      await other.goto('/account')
      await expect(other).toHaveURL(/\/access-denied\?area=buyer/)
    }
  } finally {
    await otherContext.close()
  }
})
