import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '@/lib/classes'

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

const tones: Record<Tone, string> = {
  neutral: 'border-border bg-surface-subtle text-foreground',
  success: 'border-success/35 bg-success-soft text-success',
  warning: 'border-warning/35 bg-warning-soft text-warning',
  danger: 'border-danger/35 bg-danger-soft text-danger',
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-xl border bg-surface p-5 shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  )
}

export function StatusBadge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}

export function Notice({
  title,
  tone = 'neutral',
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title?: string
  tone?: Tone
}) {
  const live = tone === 'danger' ? 'assertive' : 'polite'
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={live}
      className={cx('rounded-lg border p-4 text-sm', tones[tone], className)}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cx(title && 'mt-1')}>{children}</div> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-md bg-border', className)}
      {...props}
    />
  )
}
