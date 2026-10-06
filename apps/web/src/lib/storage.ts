import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '@ecokart/core'

const globalForStorage = globalThis as typeof globalThis & {
  ecokartStorage?: ObjectStorage
}

/** Object storage for signing photo uploads and showing photos. */
export function getStorage(): ObjectStorage {
  globalForStorage.ecokartStorage ??= createObjectStorage(loadStorageConfig())
  return globalForStorage.ecokartStorage
}
