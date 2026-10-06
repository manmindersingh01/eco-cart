import {
  recreateTestBucket,
  recreateTestDatabase,
  testDatabase,
  testStorageEnv,
} from '@ecokart/core/testing'

export async function setup(): Promise<void> {
  await Promise.all([
    recreateTestDatabase(testDatabase('worker')),
    recreateTestBucket(testStorageEnv('worker')),
  ])
}
