import {
  recreateTestBucket,
  recreateTestDatabase,
  testDatabase,
  testStorageEnv,
} from '@ecokart/core/testing'

export async function setup(): Promise<void> {
  await Promise.all([
    recreateTestDatabase(testDatabase('web')),
    recreateTestBucket(testStorageEnv('web')),
  ])
}
