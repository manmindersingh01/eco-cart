import { z } from 'zod'
import {
  emailProvider,
  encryptionKey,
  parseEnv,
  smsProvider,
} from '../../lib/config.ts'
import {
  createMailpitEmailSender,
  parseMailbox,
  type EmailSender,
} from '../../lib/email.ts'
import { createMailpitSmsSender, type SmsSender } from '../../lib/sms.ts'

/**
 * Worker settings for sending email and SMS (backend spec step 2). Only the
 * local Mailpit catcher exists so far; the production providers are added
 * when the client chooses them, and any other value stops the worker.
 */
export function loadNotificationConfig(env: NodeJS.ProcessEnv = process.env) {
  const schema = z
    .object({
      EMAIL_PROVIDER: emailProvider(env),
      EMAIL_FROM: z
        .string()
        .refine(
          (value) => parseMailbox(value) !== null,
          'must look like `EcoKart <no-reply@example.com>`',
        ),
      MAILPIT_URL: z.url().optional(),
      SMS_PROVIDER: smsProvider(env),
      MESSAGE_ENCRYPTION_KEY: encryptionKey(env),
    })
    .refine(
      (config) =>
        config.MAILPIT_URL !== undefined ||
        (config.EMAIL_PROVIDER !== 'mailpit' &&
          config.SMS_PROVIDER !== 'mailpit'),
      { path: ['MAILPIT_URL'], message: 'is required when Mailpit is used' },
    )
  const config = parseEnv(schema, env)

  const emailSender: EmailSender = createMailpitEmailSender({
    url: config.MAILPIT_URL!,
    from: parseMailbox(config.EMAIL_FROM)!,
  })
  const smsSender: SmsSender | null =
    config.SMS_PROVIDER === 'mailpit'
      ? createMailpitSmsSender({ url: config.MAILPIT_URL! })
      : null

  return {
    emailSender,
    smsSender,
    encryptionKey: config.MESSAGE_ENCRYPTION_KEY,
  }
}
