import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Tag caching for the public storefront (backend spec step 9, design doc 7).
  cacheComponents: true,
  cacheLife: {
    // Refreshed by tags the moment something changes; the times are only a
    // backstop. Browsers keep an answer for 30 seconds.
    storefront: { stale: 30, revalidate: 60 * 60, expire: 24 * 60 * 60 },
  },
  // Shares changed tags between web containers and the worker through
  // PostgreSQL (src/cache-handler.ts).
  cacheHandlers: {
    default: fileURLToPath(new URL('./src/cache-handler.ts', import.meta.url)),
  },
}

export default nextConfig
