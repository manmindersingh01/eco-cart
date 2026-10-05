import { z } from 'zod'

export type EmailOtpPurpose =
  'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

/**
 * The outbox payload of an `otp` email. `code` is sealed with
 * MESSAGE_ENCRYPTION_KEY and set to null once the email is sent or given up.
 */
export const otpEmailPayload = z.object({
  code: z.string().nullable(),
  purpose: z.enum([
    'sign-in',
    'email-verification',
    'forget-password',
    'change-email',
  ]),
  expiresAt: z.iso.datetime(),
})
export type OtpEmailPayload = z.infer<typeof otpEmailPayload>

/** The data of a send-sms job; `code` is sealed. */
export const otpSmsJob = z.object({
  to: z.string(),
  code: z.string(),
  expiresAt: z.iso.datetime(),
})
export type OtpSmsJob = z.infer<typeof otpSmsJob>

export const sendEmailJob = z.object({ outboxId: z.number().int() })
export type SendEmailJob = z.infer<typeof sendEmailJob>
