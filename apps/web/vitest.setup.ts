import { vi } from 'vitest'

// Route tests call handlers directly, outside Next.js, where 'use cache' is
// an ordinary string and cacheTag, cacheLife, and connection refuse to run.
// Caching itself is checked end to end on a production build (backend spec
// step 9).
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  cacheLife: () => {},
  cacheTag: () => {},
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => {},
}))
