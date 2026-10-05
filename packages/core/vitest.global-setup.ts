import { recreateTestDatabase } from './src/testing/database.ts'
import { testDatabase } from './src/testing/urls.ts'

export async function setup(): Promise<void> {
  await recreateTestDatabase(testDatabase('core'))
}
