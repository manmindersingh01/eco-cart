/*
 * Days for the AI limits and the usage report run from midnight to midnight
 * India time (backend spec step 17), so a limit resets when the sellers' day
 * starts, not at 5:30 in the morning.
 */

// India has kept UTC+5:30 all year since 1945, so a fixed offset is exact.
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight India time at the start of the day `now` falls in. */
export function indianDayStart(now: Date): Date {
  const local = now.getTime() + INDIA_OFFSET_MS
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - INDIA_OFFSET_MS)
}

/** The next midnight India time after `now`. */
export const nextIndianMidnight = (now: Date): Date =>
  new Date(indianDayStart(now).getTime() + DAY_MS)

/** The India date `now` falls on, as YYYY-MM-DD. */
export const indianDate = (now: Date): string =>
  new Date(now.getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10)

/** Midnight India time at the start of the India date `date` (YYYY-MM-DD). */
export const indianDateStart = (date: string): Date =>
  new Date(`${date}T00:00:00+05:30`)
