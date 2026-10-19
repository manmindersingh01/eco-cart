import { z } from 'zod'
import { strictObject, text } from '../../lib/validation.ts'

/* Seller money (design doc 5.9). */

/**
 * A seller's bank account as an administrator enters it. Spaces and hyphens
 * in the account number are dropped, and the IFSC may be typed in small
 * letters, so a number copied from a cheque leaf goes in as it is.
 */
export const bankAccountInput = strictObject({
  accountHolder: text(100),
  accountNumber: z
    .string()
    .transform((value) => value.replaceAll(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{9,18}$/, 'must be 9 to 18 digits')),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z]{4}0[A-Z0-9]{6}$/,
      'must be an IFSC of 11 characters, such as HDFC0001234',
    ),
})

/**
 * A seller's bank account as administrators and the seller see it: never
 * the full account number, only its last 4 digits.
 */
export interface BankAccountView {
  sellerId: string
  accountHolder: string
  accountNumberLast4: string
  ifsc: string
  updatedAt: Date
}

/** The full details a payout is made to; never shown in the API. */
export interface PayoutBankAccount {
  accountHolder: string
  accountNumber: string
  ifsc: string
}
