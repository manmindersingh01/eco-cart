import type { QueueDefinition } from './lib/queue.ts'
import { catalogueQueues } from './modules/catalogue/images.ts'
import { notificationQueues } from './modules/notifications/jobs.ts'

/**
 * Every job queue, created and kept up to date by `pnpm db:migrate`. A module
 * that adds jobs lists its queues here.
 */
export const QUEUES: QueueDefinition[] = [
  ...notificationQueues,
  ...catalogueQueues,
]
