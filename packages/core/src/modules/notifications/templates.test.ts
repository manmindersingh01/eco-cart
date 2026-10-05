import { describe, expect, test } from 'vitest'
import { otpEmailSubject, renderOtpEmail, renderOtpSms } from './templates.ts'

const now = new Date('2026-10-05T10:00:00Z')
const expiresAt = new Date('2026-10-05T10:05:00Z')

describe('OTP messages', () => {
  test('the email shows the code and how long it lasts', () => {
    const { text, html } = renderOtpEmail('482913', expiresAt, now)
    expect(text).toContain('Your EcoKart code is 482913.')
    expect(text).toContain('expires in 5 minutes')
    expect(html).toContain('482913')
    expect(otpEmailSubject('sign-in')).toBe('Your EcoKart sign-in code')
  })

  test('the HTML escapes what it shows', () => {
    expect(renderOtpEmail('<b>1</b>', expiresAt, now).html).toContain(
      '&lt;b&gt;1&lt;/b&gt;',
    )
  })

  test('the SMS fits in one 160-character segment', () => {
    const text = renderOtpSms('482913', expiresAt, now)
    expect(text).toBe(
      '482913 is your EcoKart code. It expires in 5 min. Do not share it with anyone.',
    )
    expect(text.length).toBeLessThanOrEqual(160)
  })
})
