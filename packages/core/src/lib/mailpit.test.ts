import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { requireEnv } from '../env.ts'
import { createMailpitEmailSender, parseMailbox } from './email.ts'
import { createMailpitSmsSender } from './sms.ts'

const mailpitUrl = requireEnv('MAILPIT_URL')

const searchResult = z.object({
  messages: z.array(z.object({ ID: z.string(), Subject: z.string() })),
})
const message = z.object({ Text: z.string() })

/** Reads the newest message to `address` back from Mailpit. */
async function lastMessageTo(address: string) {
  const query = new URLSearchParams({ query: `to:"${address}"` })
  const found = searchResult.parse(
    await (
      await fetch(`${mailpitUrl}/api/v1/search?${query.toString()}`)
    ).json(),
  )
  const first = found.messages[0]
  if (!first) return null
  const full = message.parse(
    await (await fetch(`${mailpitUrl}/api/v1/message/${first.ID}`)).json(),
  )
  return { subject: first.Subject, text: full.Text }
}

describe('Mailpit senders (local development only)', () => {
  test('deliver an email that can be read back', async () => {
    const to = `${crypto.randomUUID()}@example.test`
    const sender = createMailpitEmailSender({
      url: mailpitUrl,
      from: { name: 'EcoKart', email: 'no-reply@ecokart.test' },
    })
    const { providerMessageId } = await sender.send({
      to,
      subject: 'Your EcoKart sign-in code',
      text: 'Your EcoKart code is 482913.',
      html: '<p>Your EcoKart code is 482913.</p>',
    })
    expect(providerMessageId).not.toBe('')
    expect(await lastMessageTo(to)).toEqual({
      subject: 'Your EcoKart sign-in code',
      text: expect.stringContaining('482913'),
    })
  })

  test('deliver an SMS as an email to the number', async () => {
    const digits = `9198${String(Date.now()).slice(-8)}`
    await createMailpitSmsSender({ url: mailpitUrl }).send({
      to: `+${digits}`,
      text: '482913 is your EcoKart code.',
    })
    expect(await lastMessageTo(`${digits}@sms.mailpit.test`)).toEqual({
      subject: `SMS to +${digits}`,
      text: expect.stringContaining('482913'),
    })
  })
})

describe('parseMailbox', () => {
  test('reads a name and an address', () => {
    expect(parseMailbox('EcoKart <no-reply@ecokart.in>')).toEqual({
      name: 'EcoKart',
      email: 'no-reply@ecokart.in',
    })
    expect(parseMailbox('no-reply@ecokart.in')).toEqual({
      name: '',
      email: 'no-reply@ecokart.in',
    })
    expect(parseMailbox('EcoKart')).toBeNull()
  })
})
