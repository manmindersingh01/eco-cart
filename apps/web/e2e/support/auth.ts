import { randomUUID } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { pollUntil } from './processes.ts'

const mailSearch = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      To: z.array(z.object({ Address: z.string() })),
      Created: z.string(),
    }),
  ),
})

/** Reads only a new message addressed to this test's unique mailbox. */
export async function deliveredCode(
  email: string,
  since: number,
): Promise<string> {
  const base = process.env.MAILPIT_URL ?? 'http://localhost:8025'
  return pollUntil(
    'Mailpit OTP delivery',
    async () => {
      const response = await fetch(
        `${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        {
          signal: AbortSignal.timeout(5000),
        },
      )
      if (!response.ok) throw new Error('Mailpit search is unavailable')
      const body = mailSearch.parse(await response.json())
      const message = body.messages.find(
        (item) =>
          item.To.some(
            (recipient) =>
              recipient.Address.toLowerCase() === email.toLowerCase(),
          ) && new Date(item.Created).getTime() >= since - 1000,
      )
      if (!message) return ''
      const detail = await fetch(`${base}/api/v1/message/${message.ID}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!detail.ok) throw new Error('Mailpit message could not be read')
      const content = z.object({ Text: z.string() }).parse(await detail.json())
      return /\b(\d{6})\b/.exec(content.Text)?.[1] ?? ''
    },
    (code) => code.length === 6,
  )
}

export async function signIn(
  page: Page,
  email = `buyer-${randomUUID()}@example.test`,
  checkInvalidState?: () => Promise<void>,
) {
  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  const since = Date.now()
  await page.getByRole('button', { name: 'Send sign-in code' }).click()
  await expect(page.getByLabel('Six-digit code')).toBeVisible()
  const code = await deliveredCode(email, since)
  if (checkInvalidState) {
    await page
      .getByLabel('Six-digit code')
      .fill(code === '000000' ? '111111' : '000000')
    const refused = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/sign-in/email-otp' &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    expect((await refused).status()).toBe(400)
    await expect(
      page.getByRole('alert').filter({ hasText: 'Sign-in failed' }),
    ).toBeVisible()
    await checkInvalidState()
  }
  await page.getByLabel('Six-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
  const me = await page.request.get('/api/me')
  expect(me.status()).toBe(200)
  return z
    .object({ role: z.string(), email: z.string() })
    .parse(await me.json())
}
