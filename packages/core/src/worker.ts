// Worker-only exports: these load the image library, which the web app never
// needs. Application code in the web app imports from '@ecokart/core'.
export {
  processUploadedImage,
  registerCatalogueJobs,
  type CatalogueJobDependencies,
} from './modules/catalogue/jobs.ts'
// Loads the PDF library.
export {
  registerInvoiceJobs,
  renderInvoice,
  type InvoiceJobDependencies,
} from './modules/invoices/jobs.ts'
