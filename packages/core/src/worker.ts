// Worker-only exports: these load the image library, which the web app never
// needs. Application code in the web app imports from '@ecokart/core'.
export {
  processUploadedImage,
  processUploadedVideo,
  registerCatalogueJobs,
  type CatalogueJobDependencies,
} from './modules/catalogue/jobs.ts'
// Runs ffmpeg and ffprobe.
export {
  checkVideoTools,
  loadVideoTools,
  prepareProductVideo,
  VideoRejectedError,
  type PreparedVideo,
  type VideoTools,
} from './lib/video-processing.ts'
// Loads the PDF library.
export {
  registerInvoiceJobs,
  renderInvoice,
  type InvoiceJobDependencies,
} from './modules/invoices/jobs.ts'
