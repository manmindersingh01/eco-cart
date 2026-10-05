import { drizzle } from 'drizzle-orm/node-postgres'
import { createAuth } from './auth.ts'

/*
 * Read only by the Better Auth CLI (`pnpm auth:schema`) to generate the
 * Drizzle schema for its tables. It uses the real configuration, so the
 * generated tables always match what the running app expects. Nothing here
 * connects to a database or sends a message.
 */
function notForRuntime(): never {
  throw new Error('schema-config.ts is only for schema generation')
}

export const auth = createAuth({
  db: drizzle.mock(),
  baseURL: 'http://localhost:3000',
  secret: 'schema-generation-only-not-a-real-secret',
  // On, so the generated schema includes everything phone sign-in needs.
  smsOtpEnabled: true,
  sendEmailOtp: async () => notForRuntime(),
  sendSmsOtp: async () => notForRuntime(),
  allowCodeRequest: async () => notForRuntime(),
  recordAdminAction: async () => notForRuntime(),
  ownsSellerBusiness: async () => notForRuntime(),
  validateSchema: false,
})
