// What the web app's cache handler needs (apps/web/src/cache-handler.ts).
// Next.js loads that file on its own, outside the app's bundle, so this entry
// point keeps it from loading the whole of '@ecokart/core'.
export { createDatabase, type Database } from './db/client.ts'
export { createPool, type DatabasePool } from './db/pool.ts'
export {
  readCacheInvalidations,
  recordCacheInvalidations,
  type CacheInvalidationRead,
} from './lib/cache.ts'
