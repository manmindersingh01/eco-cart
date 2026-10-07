const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentage = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const indianDate = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

const indianDateTime = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
  timeZoneName: 'short',
})

export function formatInr(paise: number | bigint): string {
  return inr.format(Number(paise) / 100)
}

export function formatBasisPoints(basisPoints: number): string {
  return percentage.format(basisPoints / 10_000)
}

export function formatIndianDate(
  value: Date | string | number,
  options: { includeTime?: boolean } = {},
): string {
  const date = value instanceof Date ? value : new Date(value)
  return (options.includeTime ? indianDateTime : indianDate).format(date)
}

export function formatStatusLabel(status: string): string {
  return status
    .trim()
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase())
}
