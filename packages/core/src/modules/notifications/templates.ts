import type { EmailOtpPurpose } from './types.ts'

/*
 * Message wording. Plain text is the main form; the HTML version carries the
 * same words. Every value put into HTML is escaped.
 */

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const minutesUntil = (expiresAt: Date, now: Date) =>
  Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 60_000))

export function otpEmailSubject(purpose: EmailOtpPurpose): string {
  return purpose === 'sign-in'
    ? 'Your EcoKart sign-in code'
    : 'Your EcoKart verification code'
}

export function renderOtpEmail(
  code: string,
  expiresAt: Date,
  now: Date,
): { text: string; html: string } {
  const minutes = minutesUntil(expiresAt, now)
  const lines = [
    `Your EcoKart code is ${code}.`,
    `It works once and expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    'If you did not ask for it, you can ignore this email.',
    'Never share this code with anyone, including anyone who says they are from EcoKart.',
  ]
  return {
    text: lines.join('\n\n'),
    html: [
      `<p>Your EcoKart code is</p>`,
      `<p style="font-size:28px;font-weight:600;letter-spacing:4px">${escapeHtml(code)}</p>`,
      ...lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`),
    ].join('\n'),
  }
}

/** Kept short: one SMS segment. The DLT template must match it exactly. */
export function renderOtpSms(code: string, expiresAt: Date, now: Date): string {
  const minutes = minutesUntil(expiresAt, now)
  return `${code} is your EcoKart code. It expires in ${minutes} min. Do not share it with anyone.`
}
