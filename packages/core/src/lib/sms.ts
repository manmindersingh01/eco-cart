import { sendToMailpit } from './mailpit.ts'

export interface SmsMessage {
  /** E.164, for example +919812345678. */
  to: string
  text: string
}

export interface SmsSender {
  send(message: SmsMessage): Promise<{ providerMessageId: string }>
}

/**
 * Local development and tests only (SMS_PROVIDER=mailpit). Each SMS arrives
 * in Mailpit as an email to <number>@sms.mailpit.test, so phone sign-in can
 * be tried without an SMS provider.
 */
export function createMailpitSmsSender(options: { url: string }): SmsSender {
  return {
    async send(message) {
      const id = await sendToMailpit(options.url, {
        from: { name: 'EcoKart SMS', email: 'sms@sms.mailpit.test' },
        to: `${message.to.replace(/^\+/, '')}@sms.mailpit.test`,
        subject: `SMS to ${message.to}`,
        text: message.text,
      })
      return { providerMessageId: id }
    },
  }
}
