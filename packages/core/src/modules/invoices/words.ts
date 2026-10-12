/*
 * The invoice total in words, in the Indian numbering system (thousand,
 * lakh, crore), as Indian invoices customarily print it.
 */

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
]

function belowHundred(value: number): string {
  if (value < 20) return ONES[value]!
  const ones = value % 10
  return ones === 0
    ? TENS[Math.floor(value / 10)]!
    : `${TENS[Math.floor(value / 10)]}-${ONES[ones]}`
}

const SCALES: [divisor: number, name: string][] = [
  [10_000_000, 'Crore'],
  [100_000, 'Lakh'],
  [1_000, 'Thousand'],
  [100, 'Hundred'],
]

/** A whole number in words, for example 102000 is "One Lakh Two Thousand". */
export function numberInWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Cannot write ${value} in words`)
  }
  if (value < 100) return belowHundred(value)
  const words: string[] = []
  let rest = value
  for (const [divisor, name] of SCALES) {
    if (rest < divisor) continue
    const count = Math.floor(rest / divisor)
    // More than 99 crore reads as "One Hundred Crore" and so on.
    words.push(`${numberInWords(count)} ${name}`)
    rest %= divisor
  }
  if (rest > 0) words.push(belowHundred(rest))
  return words.join(' ')
}

/**
 * For example 10200050 paise is "Rupees One Lakh Two Thousand and Fifty
 * Paise Only".
 */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error(`Cannot write ${paise} paise in words`)
  }
  const rupees = Math.floor(paise / 100)
  const rest = paise % 100
  const paiseWords = rest > 0 ? ` and ${belowHundred(rest)} Paise` : ''
  return `Rupees ${numberInWords(rupees)}${paiseWords} Only`
}
