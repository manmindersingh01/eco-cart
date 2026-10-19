export { createDatabase, type Database, type Transaction } from './db/client.ts'
export { withContext, type RequestContext } from './db/context.ts'
export { checkDatabase, createPool, type DatabasePool } from './db/pool.ts'
export * as schema from './db/schema/index.ts'
export { requireEnv } from './env.ts'
export {
  ConflictError,
  ForbiddenError,
  NotConfiguredError,
  NotFoundError,
  NotSignedInError,
  TooManyRequestsError,
  UnavailableError,
  ValidationError,
} from './errors.ts'
export { QUEUES } from './jobs.ts'
export {
  startJobQueue,
  type JobQueue,
  type QueueDefinition,
} from './lib/queue.ts'
export { isPlaceholderEmail, type Auth } from './modules/auth/auth.ts'
export { loadAuthConfig, type AuthConfig } from './modules/auth/config.ts'
export {
  createAppAuth,
  ensureAdministrator,
  resolveRequestContext,
  SellerAccountNotReadyError,
  SellerSuspendedError,
} from './modules/auth/service.ts'
export {
  createAccountDirectory,
  type Account,
  type AccountDirectory,
} from './modules/auth/accounts.ts'
export { loadNotificationConfig } from './modules/notifications/config.ts'
export { registerNotificationJobs } from './modules/notifications/jobs.ts'
export {
  settingKeys,
  type CompanyDetails,
  type SettingKey,
  type SettingValue,
} from './modules/settings/definitions.ts'
export {
  getSetting,
  listSettings,
  updateSetting,
  type SettingView,
} from './modules/settings/service.ts'
export {
  approveSeller,
  createSeller,
  getOwnSeller,
  getSeller,
  listSellers,
  reinstateSeller,
  suspendSeller,
  updateOwnContacts,
  updateSeller,
  type SellerDetail,
  type SellerServices,
  type SellerSummary,
} from './modules/sellers/service.ts'
export type { SellerStatus, SellerView } from './modules/sellers/types.ts'
export {
  acceptSellerDocument,
  addDocumentFile,
  cancelSellerDocument,
  CHECK_DOCUMENT_QUEUE,
  createDocumentUpload,
  getDocumentDownload,
  getDocumentRequest,
  listDocumentsToReview,
  listOwnDocumentRequests,
  listSellerDocumentRequests,
  rejectSellerDocument,
  requestSellerDocuments,
} from './modules/sellers/documents.ts'
export {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  type DocumentContentType,
  type DocumentDownload,
  type DocumentFileStatus,
  type DocumentFileView,
  type DocumentRequestStatus,
  type DocumentRequestView,
  type DocumentToReview,
  type DocumentType,
  type DocumentUpload,
} from './modules/sellers/types.ts'
export {
  getOwnBankAccount,
  getSellerBankAccount,
  setSellerBankAccount,
} from './modules/ledger/bank-accounts.ts'
export { loadLedgerConfig, type LedgerConfig } from './modules/ledger/config.ts'
export type { BankAccountView } from './modules/ledger/types.ts'
export {
  addReturnPhoto,
  attachReturnPhotos,
  CHECK_RETURN_PHOTO_QUEUE,
  createReturnPhotoUpload,
  getReturnPhoto,
  getReturnPhotoDownload,
} from './modules/returns/photos.ts'
export {
  MAX_PHOTOS_PER_RETURN,
  type ReturnPhotoDownload,
  type ReturnPhotoStatus,
  type ReturnPhotoUpload,
  type ReturnPhotoView,
} from './modules/returns/types.ts'
export type { Page } from './lib/pagination.ts'
export {
  createCategory,
  deleteCategory,
  getCategoryTree,
  getFullCategoryTree,
  loadCategoryTree,
  updateCategory,
} from './modules/catalogue/categories.ts'
export {
  createBrand,
  deleteBrand,
  listAllBrands,
  listBrands,
  updateBrand,
} from './modules/catalogue/brands.ts'
export {
  buildCategoryTree,
  MAX_CATEGORY_DEPTH,
  type CategoryTree,
} from './modules/catalogue/tree.ts'
export type {
  BrandListOptions,
  BrandView,
  CategoryNode,
  CategoryView,
  NewBrand,
  NewCategory,
  PublicBrand,
  PublicCategory,
} from './modules/catalogue/types.ts'
export {
  addVariant,
  createProduct,
  deleteProduct,
  deleteVariant,
  getOwnProduct,
  listOwnProducts,
  updateProduct,
  updateVariant,
  type PhotoAddresses,
} from './modules/catalogue/products.ts'
export {
  addImage,
  createImageUpload,
  MAX_IMAGES_PER_PRODUCT,
  PROCESS_IMAGE_QUEUE,
  removeImage,
  setImageOrder,
  updateImage,
} from './modules/catalogue/images.ts'
export {
  addVideo,
  createVideoUpload,
  PROCESS_VIDEO_QUEUE,
  removeVideo,
} from './modules/catalogue/videos.ts'
export {
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_UPLOAD_BYTES,
  VIDEO_CONTENT_TYPES,
} from './lib/videos.ts'
export type {
  ImageUpload,
  ImageView,
  NewProduct,
  NewVariant,
  ProductStatus,
  ProductSummary,
  ProductView,
  VariantView,
  VideoView,
} from './modules/catalogue/types.ts'
export {
  createImport,
  createImportUpload,
  getImport,
  getImportErrorReport,
  listImports,
  READ_IMPORT_QUEUE,
  RUN_IMPORT_QUEUE,
  setImportMapping,
} from './modules/imports/service.ts'
export {
  IMPORT_FIELD_INFO,
  IMPORT_FIELDS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  type ImportErrorReport,
  type ImportField,
  type ImportFieldInfo,
  type ImportFileType,
  type ImportStatus,
  type ImportSummary,
  type ImportUpload,
  type ImportView,
} from './modules/imports/types.ts'
export {
  approveProduct,
  archiveProduct,
  getProductForReview,
  listReviewQueue,
  moveToDraft,
  rejectProduct,
  submitProduct,
  takeDownProduct,
} from './modules/catalogue/moderation.ts'
export {
  screenListing,
  SCREEN_LISTING_QUEUE,
  type ScreeningDependencies,
} from './modules/catalogue/screening.ts'
export type {
  ProductForReview,
  ReviewQueueItem,
  ReviewView,
  RiskLevel,
  ScreeningFlag,
} from './modules/catalogue/types.ts'
export type { SellerLabel } from './modules/sellers/service.ts'
export {
  cancelInvoices,
  getInvoiceDownload,
  issueInvoices,
  listOrderInvoices,
  listOwnInvoices,
  RENDER_INVOICE_QUEUE,
  rerenderInvoice,
} from './modules/invoices/service.ts'
export type {
  InvoiceDownload,
  InvoiceSummary,
  IssuedInvoice,
} from './modules/invoices/types.ts'
export {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
  type StorageConfig,
  type UploadForm,
} from './lib/storage.ts'
export {
  activeBrandIds,
  getCategoryPage,
  getHomePage,
  getPublicProduct,
  listingFilters,
  listPublicProducts,
  queryObject,
  type ListSort,
  type ProductListQuery,
  type WordMatch,
} from './modules/catalogue/storefront.ts'
export type {
  CategoryLink,
  CategoryPage,
  HomeSection,
  ProductCard,
  ProductFilters,
  PublicImage,
  PublicProduct,
  PublicVariant,
  PublicVideo,
  StorefrontSort,
} from './modules/catalogue/storefront-types.ts'
export {
  getPublicSellers,
  type PublicSeller,
} from './modules/sellers/service.ts'
export {
  consumeSearchAllowance,
  listSearchGaps,
  searchProducts,
} from './modules/search/service.ts'
export type { SearchGap, SearchResult } from './modules/search/types.ts'
export { clientAddress, trustedProxyCount } from './lib/client-address.ts'
export { IMAGE_SIZES, type ImageSize } from './lib/images.ts'
export {
  CLEAR_CACHE_INVALIDATIONS_QUEUE,
  invalidateStorefront,
  registerStorefrontCacheJobs,
  storefrontTags,
  type StorefrontChange,
} from './modules/catalogue/storefront-cache.ts'
export {
  addAddress,
  deleteAddress,
  getAddress,
  getShippingAddress,
  listAddresses,
  MAX_ADDRESSES,
  updateAddress,
} from './modules/addresses/service.ts'
export type {
  AddressUpdate,
  AddressView,
  NewAddress,
} from './modules/addresses/types.ts'
export {
  GST_STATES,
  isGstStateCode,
  stateName,
  type GstState,
} from './lib/states.ts'
// AI client, request log, cache, and daily limits (backend spec step 17).
export {
  AiProviderError,
  AiReplyError,
  type AiEndpoint,
  type AiUsage,
  type ModelReply,
} from './lib/ai/client.ts'
export type {
  ChatOptions,
  JsonPrompt,
  TextModel,
  VisionModel,
} from './lib/ai/chat.ts'
export {
  EMBEDDING_DIMENSIONS,
  type EmbedInput,
  type EmbedInputType,
  type Embedder,
} from './lib/ai/embed.ts'
export {
  createAiModels,
  type AiModels,
  type AiSettings,
} from './lib/ai/index.ts'
export { loadAiConfig } from './lib/ai/config.ts'
export {
  callAi,
  queueAiCall,
  runQueuedAiCall,
  type AiAnswer,
  type AiCall,
  type AiQueuedCall,
  type QueuedAiCall,
} from './modules/ai/service.ts'
export {
  getAiUsage,
  type AiUsageLine,
  type AiUsageReport,
} from './modules/ai/queries.ts'
export type { AiFeature, AiRequestStatus } from './modules/ai/types.ts'
// The listing builder (backend spec step 19).
export {
  DRAFT_LISTING_QUEUE,
  getListingDraft,
  requestListingDraft,
  writeListingDraft,
  type ListingDraftView,
} from './modules/catalogue/drafts.ts'
export type { ListingSuggestion } from './modules/catalogue/types.ts'
export {
  addCartItem,
  applyCoupon,
  getCart,
  removeCartItem,
  removeCoupon,
  setCartItemQuantity,
  type Shopper,
} from './modules/cart/service.ts'
export {
  createCoupon,
  getCoupon,
  listCoupons,
  updateCoupon,
} from './modules/cart/coupons.ts'
export {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  type CartCoupon,
  type CartLine,
  type CartView,
  type CouponUpdate,
  type CouponView,
  type NewCoupon,
} from './modules/cart/types.ts'
export { formatRupees } from './lib/money.ts'
export {
  checkoutOptions,
  placeOrder,
  type BuyerAccount,
  type PlacedOrder,
} from './modules/checkout/service.ts'
export {
  confirmCheckoutPayment,
  confirmOrderPayment,
  handleRazorpayWebhook,
  type ConfirmationOutcome,
  type PaymentResult,
  type WebhookOutcome,
} from './modules/payments/service.ts'
export {
  EXPIRE_UNPAID_QUEUE,
  expireUnpaidOrders,
  registerOrderJobs,
} from './modules/orders/jobs.ts'
export {
  createRazorpay,
  loadRazorpayConfig,
  type Razorpay,
  type RazorpayConfig,
} from './lib/razorpay.ts'
// Reviews, content pages, and the storefront footer (backend spec step 16).
export {
  getOwnReview,
  listProductReviews,
  listReviews,
  setReviewStatus,
  updateOwnReview,
  writeReview,
} from './modules/reviews/service.ts'
export type {
  AdminReview,
  AdminReviewOptions,
  OwnReview,
  PublicReview,
  ReviewStatus,
} from './modules/reviews/types.ts'
export {
  getContentPage,
  getPublishedContentPage,
  listContentPages,
  saveContentPage,
} from './modules/content/service.ts'
export {
  CONTENT_PAGES,
  CONTENT_SLUGS,
  type ContentPageView,
  type ContentSlug,
  type PublicContentPage,
} from './modules/content/types.ts'
export {
  getPublicCompanyDetails,
  type PublicCompanyDetails,
} from './modules/settings/service.ts'
export {
  findProductOnSale,
  getProductLabels,
  type ProductLabel,
} from './modules/catalogue/storefront.ts'
