import { createAccountDirectory, type SellerServices } from '@ecokart/core'
import { getAuth } from './auth'
import { getDatabase } from './db'

/** What the seller service needs: the database and Better Auth's accounts. */
export function getSellerServices(): SellerServices {
  return { db: getDatabase(), accounts: createAccountDirectory(getAuth()) }
}
