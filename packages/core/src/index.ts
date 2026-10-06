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
  ValidationError,
} from './errors.ts'
export { QUEUES } from './jobs.ts'
export {
  startJobQueue,
  type JobQueue,
  type QueueDefinition,
} from './lib/queue.ts'
export { type Auth } from './modules/auth/auth.ts'
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
export type {
  ImageUpload,
  ImageView,
  NewProduct,
  NewVariant,
  ProductStatus,
  ProductSummary,
  ProductView,
  VariantView,
} from './modules/catalogue/types.ts'
export {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
  type StorageConfig,
  type UploadForm,
} from './lib/storage.ts'
