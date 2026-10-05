import { z } from 'zod'
import {
  encryptionKey,
  parseEnv,
  secretString,
  smsProvider,
} from '../../lib/config.ts'

/** Web app settings for sign-in (backend spec step 2). */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = parseEnv(
    z.object({
      BETTER_AUTH_URL: z.url(),
      BETTER_AUTH_SECRET: secretString(env, 32),
      MESSAGE_ENCRYPTION_KEY: encryptionKey(env),
      SMS_PROVIDER: smsProvider,
    }),
    env,
  )
  return {
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    encryptionKey: config.MESSAGE_ENCRYPTION_KEY,
    smsOtpEnabled: config.SMS_PROVIDER !== 'none',
  }
}

export type AuthConfig = ReturnType<typeof loadAuthConfig>
