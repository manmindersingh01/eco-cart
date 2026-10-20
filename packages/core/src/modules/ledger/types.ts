import { z } from 'zod'
import type { Page } from '../../lib/pagination.ts'
import { strictObject, text, wholeNumber } from '../../lib/validation.ts'
import { indianDate, indianDateStart } from '../ai/days.ts'
import type { SellerStatus } from '../sellers/types.ts'

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

/*
 * TCS, the 1% tax collected at source on sellers' sales (GST section 52), is
 * not collected yet. When the client decides it, it becomes an entry type of
 * its own, written with each sale, and balances and settlement statements
 * show it with no other change.
 */
export type LedgerEntryType =
  | 'sale'
  | 'commission'
  | 'refund_reversal'
  | 'commission_reversal'
  | 'payout'
  | 'adjustment'

/** One line of a seller's ledger. */
export interface LedgerEntryView {
  id: number
  entryType: LedgerEntryType
  /** Positive when EcoKart owes it to the seller, negative when taken back or paid out. */
  amountPaise: number
  description: string
  /** The bank's transfer reference, on payouts. */
  reference: string | null
  orderId: string | null
  orderItemId: string | null
  returnRequestId: string | null
  createdAt: Date
}

/** A page of a seller's ledger, newest first, with their balance now. */
export interface SellerLedger extends Page<LedgerEntryView> {
  sellerId: string
  /**
   * What EcoKart owes the seller: the sum of every entry. Negative when the
   * seller owes EcoKart, for example after a refund larger than their sales.
   */
  balancePaise: number
}

/** A seller with money to settle, for the administrators' payout list. */
export interface SellerBalance {
  sellerId: string
  displayName: string
  status: SellerStatus
  balancePaise: number
  /** Where a payout goes; null until an administrator enters it. */
  bankAccount: { accountNumberLast4: string; ifsc: string } | null
}

/**
 * A bank transfer an administrator made to a seller, recorded with the
 * bank's reference (UTR) in capitals, so the same transfer cannot be
 * recorded twice in different letters.
 */
export const payoutInput = strictObject({
  amountPaise: wholeNumber(1),
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9/-]{6,40}$/,
      'must be the transfer reference from the bank: 6 to 40 letters, digits, hyphens, or slashes',
    ),
})

/** A correction to a seller's balance: positive pays them more, negative takes back. */
export const adjustmentInput = strictObject({
  amountPaise: wholeNumber(
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  ).refine((value) => value !== 0, 'must not be 0'),
  reason: text(500),
})

/** A date in India, like 2026-10-01. */
const indiaDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'must be a date like 2026-10-01',
    abort: true,
  })
  .refine((value) => {
    // 2026-02-30 is not a date, and some engines roll it over to 2 March.
    const start = indianDateStart(value)
    return !Number.isNaN(start.getTime()) && indianDate(start) === value
  }, 'must be a real date')

/** The longest period one statement covers: a year, leap day included. */
export const MAX_STATEMENT_DAYS = 366

/** Statements one seller may ask for in a day, which keeps the worker free. */
export const MAX_STATEMENTS_PER_DAY = 20

/** The period of a settlement statement, both dates included. */
export const statementRequest = strictObject({
  from: indiaDate,
  to: indiaDate,
})

export type SettlementStatementStatus = 'processing' | 'ready' | 'failed'

export interface SettlementStatementView {
  id: string
  sellerId: string
  /** India dates, both included. */
  from: string
  to: string
  status: SettlementStatementStatus
  /** Set once the worker has made the file. */
  openingBalancePaise: number | null
  closingBalancePaise: number | null
  entryCount: number | null
  /** Why the statement could not be made. */
  failureReason: string | null
  requestedAt: Date
  /** When the file was made; entries added later are not in it. */
  madeAt: Date | null
}

export interface SettlementStatementDownload {
  /** A signed link to the CSV; it stops working at `expiresAt`. */
  url: string
  expiresAt: Date
  fileName: string
}
