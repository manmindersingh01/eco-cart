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
