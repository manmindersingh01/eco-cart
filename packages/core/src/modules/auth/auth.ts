import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { admin, emailOTP, phoneNumber } from 'better-auth/plugins'

export type EmailOtpPurpose =
  'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

export interface AuthDependencies {
  /** A Drizzle database whose schema includes the four Better Auth tables. */
  db: Parameters<typeof drizzleAdapter>[0]
  baseURL: string
  secret: string
  /** Queues the OTP email. Must never send inline (CLAUDE.md, design doc 6.1). */
  sendEmailOtp: (message: {
    email: string
    otp: string
    type: EmailOtpPurpose
  }) => Promise<void>
  /** Queues the OTP SMS. Must never send inline. */
  sendSmsOtp: (message: { phoneNumber: string; code: string }) => Promise<void>
  /**
   * Better Auth checks at runtime that the database has its tables. Only the
   * schema generation config turns this off, because it has no database.
   */
  validateSchema?: boolean
}

/**
 * Better Auth configuration (design doc 3, 5.3, 6.1). The options here also
 * decide the shape of the users, sessions, accounts, and verifications
 * tables, so after changing a plugin run `pnpm auth:schema` and then
 * `pnpm db:generate`.
 */
export function createAuth(dependencies: AuthDependencies) {
  return betterAuth({
    baseURL: dependencies.baseURL,
    secret: dependencies.secret,
    database: drizzleAdapter(dependencies.db, {
      provider: 'pg',
      usePlural: true,
    }),
    advanced: {
      database: {
        generateId: 'uuid',
        validateSchema: dependencies.validateSchema ?? true,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        sendVerificationOTP: ({ email, otp, type }) =>
          dependencies.sendEmailOtp({ email, otp, type }),
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        sendOTP: (message) =>
          dependencies.sendSmsOtp({
            phoneNumber: message.phoneNumber,
            code: message.code,
          }),
      }),
      admin({
        defaultRole: 'buyer',
        adminRoles: ['admin'],
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
