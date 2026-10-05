import { z } from 'zod'

/*
 * Mailpit is the local mail catcher in compose.yaml (http://localhost:8025).
 * It accepts messages over a small HTTP API, so local email and SMS delivery
 * need no SMTP library. It is never used in production.
 */

export interface MailpitMessage {
  from: { name: string; email: string }
  to: string
  subject: string
  text: string
  html?: string
}

const sendResponse = z.object({ ID: z.string() })

/** Delivers one message to Mailpit and returns Mailpit's id for it. */
export async function sendToMailpit(
  baseUrl: string,
  message: MailpitMessage,
): Promise<string> {
  const response = await fetch(new URL('/api/v1/send', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      From: { Name: message.from.name, Email: message.from.email },
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      ...(message.html === undefined ? {} : { HTML: message.html }),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(
      `Mailpit refused the message: ${response.status} ${(await response.text()).slice(0, 200)}`,
    )
  }
  return sendResponse.parse(await response.json()).ID
}
