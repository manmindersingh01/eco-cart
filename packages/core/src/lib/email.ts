import { sendToMailpit } from './mailpit.ts'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>
}

export interface Mailbox {
  name: string
  email: string
}

/** Reads a sender such as `EcoKart <no-reply@ecokart.in>`. */
export function parseMailbox(value: string): Mailbox | null {
  const match =
    /^\s*(?:(.*?)\s*<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))\s*$/.exec(value)
  if (!match) return null
  const email = match[2] ?? match[3]
  return email ? { name: match[1] ?? '', email } : null
}

/** Local development and tests only (EMAIL_PROVIDER=mailpit). */
export function createMailpitEmailSender(options: {
  url: string
  from: Mailbox
}): EmailSender {
  return {
    async send(message) {
      const id = await sendToMailpit(options.url, {
        from: options.from,
        ...message,
      })
      return { providerMessageId: id }
    },
  }
}
