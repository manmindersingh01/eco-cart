import { recreateTestDatabase, testDatabase } from '@ecokart/core/testing'

export async function setup(): Promise<void> {
  await recreateTestDatabase(testDatabase('worker'))
}
