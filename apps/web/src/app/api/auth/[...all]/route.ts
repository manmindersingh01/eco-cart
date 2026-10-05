import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

// Better Auth's own endpoints: sending and checking sign-in codes, sessions,
// signing out, and the administrator account endpoints (design doc 6.1).
export const { GET, POST } = toNextJsHandler((request) =>
  getAuth().handler(request),
)
