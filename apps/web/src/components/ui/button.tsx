import type { Route } from 'next'
import Link, { type LinkProps } from 'next/link'
import type { AnchorHTMLAttributes, ComponentPropsWithRef } from 'react'
import { cx } from '@/lib/classes'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong',
  secondary:
    'border bg-surface text-foreground hover:border-brand hover:text-brand-strong',
  danger: 'bg-danger text-white hover:brightness-90',
  quiet: 'text-brand-strong hover:bg-brand-soft',
}

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant
}

export function Button({
  className,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(base, variants[variant], className)}
      {...props}
    />
  )
}

type IconButtonProps = ButtonProps & { 'aria-label': string }

export function IconButton({ className, ...props }: IconButtonProps) {
  return <Button className={cx('size-11 shrink-0 p-0', className)} {...props} />
}

// Generic like Link itself, so a dynamic address such as
// `/categories/${slug}` is checked against the app's routes.
type LinkButtonProps<RouteType> = LinkProps<RouteType> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps<RouteType>> & {
    variant?: ButtonVariant
  }

export function LinkButton<RouteType = Route>({
  className,
  variant = 'primary',
  ...props
}: LinkButtonProps<RouteType>) {
  return <Link className={cx(base, variants[variant], className)} {...props} />
}

export function PaginationButton(props: ButtonProps) {
  return <Button variant="secondary" {...props} />
}
