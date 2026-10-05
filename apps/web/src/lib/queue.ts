import { requireEnv, startJobQueue, type JobQueue } from '@ecokart/core'

const globalForQueue = globalThis as typeof globalThis & {
  ecokartJobQueue?: Promise<JobQueue>
}

/**
 * The client the web app sends background jobs with. It connects on first
 * use, so requests that never queue a job never open its connections.
 */
export function getJobQueue(): Promise<JobQueue> {
  globalForQueue.ecokartJobQueue ??= startJobQueue(
    requireEnv('DATABASE_URL'),
    'ecokart-web-queue',
  ).catch((error: unknown) => {
    // Let the next request try again instead of failing forever.
    globalForQueue.ecokartJobQueue = undefined
    throw error
  })
  return globalForQueue.ecokartJobQueue
}

export async function closeJobQueue(): Promise<void> {
  const queue = globalForQueue.ecokartJobQueue
  globalForQueue.ecokartJobQueue = undefined
  await (await queue)?.stop()
}
