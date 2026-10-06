import {
  loadNotificationConfig,
  loadStorageConfig,
  requireEnv,
} from '@ecokart/core'
import { startWorker } from './worker.ts'

// Settings are read once, so a missing or wrong one stops the worker here
// with a clear message instead of failing on the first job.
const worker = await startWorker({
  databaseUrl: requireEnv('DATABASE_URL'),
  notifications: loadNotificationConfig(),
  storage: loadStorageConfig(),
})
console.info('Worker started')

// ECS sends SIGTERM before replacing a task. Stopping gracefully lets running
// jobs finish (pg-boss waits up to 30 seconds) instead of cutting them off.
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.info(`Received ${signal}, waiting for running jobs to finish`)
  try {
    await worker.stop()
    console.info('Worker stopped')
  } catch (error) {
    console.error('Worker did not stop cleanly', error)
    process.exitCode = 1
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal))
}
