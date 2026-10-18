import type { QueueDefinition } from './lib/queue.ts'
import { draftQueues } from './modules/catalogue/drafts.ts'
import { catalogueQueues } from './modules/catalogue/images.ts'
import { screeningQueues } from './modules/catalogue/screening.ts'
import { storefrontCacheQueues } from './modules/catalogue/storefront-cache.ts'
import { videoQueues } from './modules/catalogue/videos.ts'
import { invoiceQueues } from './modules/invoices/service.ts'
import { notificationQueues } from './modules/notifications/jobs.ts'
import { sellerQueues } from './modules/sellers/documents.ts'

/**
 * Every job queue, created and kept up to date by `pnpm db:migrate`. A module
 * that adds jobs lists its queues here.
 */
export const QUEUES: QueueDefinition[] = [
  ...notificationQueues,
  ...catalogueQueues,
  ...videoQueues,
  ...screeningQueues,
  ...draftQueues,
  ...invoiceQueues,
  ...storefrontCacheQueues,
  ...sellerQueues,
]
