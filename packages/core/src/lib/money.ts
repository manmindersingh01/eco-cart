/*
 * Money in messages and emails. Amounts stay whole paise everywhere (design
 * doc 5.1); only the text shown to people turns them into rupees.
 */

const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

/**
 * Rupees with Indian digit grouping: ₹1,00,000 from 10000000 paise, and
 * ₹1,02,000.50 from 10200050. The rupees are a whole number and the paise are
 * appended, so no amount passes through a fraction.
 */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const amount = Math.abs(paise)
  const rupees = wholeRupees.format(Math.floor(amount / 100))
  const rest = amount % 100
  return rest === 0
    ? `${sign}${rupees}`
    : `${sign}${rupees}.${String(rest).padStart(2, '0')}`
}

/**
 * Rupees as a plain number with two decimals and no grouping, for files that
 * spreadsheets add up: 1234.50 from 123450 paise, -0.05 from -5.
 */
export function plainRupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const amount = Math.abs(paise)
  return `${sign}${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`
}
