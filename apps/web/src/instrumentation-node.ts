import { checkWebSettings } from './lib/settings'

// Loaded by instrumentation.ts on the Node.js runtime only, at server start.
try {
  checkWebSettings()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  // Next.js only logs a failed start-up hook and keeps answering with 500s;
  // a server with broken settings must stop, so the deploy fails instead.
  process.exit(1)
}
