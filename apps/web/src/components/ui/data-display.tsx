import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from 'react'
import { cx } from '@/lib/classes'

export function ResponsiveDataList({
  table,
  cards,
}: {
  table: ReactNode
  cards: ReactNode
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border bg-surface md:block">
        {table}
      </div>
      <div className="grid gap-3 md:hidden">{cards}</div>
    </>
  )
}

export function DataTable({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cx('w-full border-collapse text-left text-sm', className)}
      {...props}
    />
  )
}

export function DataCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cx('rounded-xl border bg-surface p-4', className)}
      {...props}
    />
  )
}

/**
 * Details in two columns from the small breakpoint, or one while two would
 * be narrower than 10rem, the width of a GSTIN kept on one line.
 */
export function DetailList({
  className,
  ...props
}: HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cx(
        'grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(max(10rem,calc(50%_-_0.5rem)),1fr))]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * One label and value in a `<dl>`. `code` keeps an identifier such as a
 * GSTIN, PAN, or invoice number on one line: broken in two it reads as two
 * values and is hard to copy. DetailList keeps its columns wide enough.
 * A blank value reads as a muted "Not given", for example the name of a
 * buyer who applied to sell without setting one.
 */
export function Detail({
  label,
  value,
  code = false,
}: {
  label: string
  value: string
  code?: boolean
}) {
  const missing = value.trim() === ''
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd
        className={cx(
          'mt-1',
          missing
            ? 'text-muted'
            : cx('font-medium', code ? 'whitespace-nowrap' : 'break-words'),
        )}
      >
        {missing ? 'Not given' : value}
      </dd>
    </div>
  )
}
