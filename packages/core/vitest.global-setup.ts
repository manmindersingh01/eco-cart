import { recreateTestDatabase } from './src/testing/database.ts'
import { recreateTestBucket } from './src/testing/storage.ts'
import { testDatabase, testStorageEnv } from './src/testing/urls.ts'

export async function setup(): Promise<void> {
  await Promise.all([
    recreateTestDatabase(testDatabase('core')),
    recreateTestBucket(testStorageEnv('core')),
  ])
}
