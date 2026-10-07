import type {
  AriaAttributes,
  ComponentPropsWithRef,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cloneElement } from 'react'
import { cx } from '@/lib/classes'

const control =
  'min-h-11 w-full rounded-lg border bg-surface px-3 py-2 text-foreground shadow-sm placeholder:text-muted/75 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-70 aria-invalid:border-danger'

type FieldProps = {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactElement<{
    id?: string
    'aria-describedby'?: string
    'aria-invalid'?: AriaAttributes['aria-invalid']
  }>
  className?: string
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: FieldProps) {
  const describedBy = error
    ? `${htmlFor}-error`
    : hint
      ? `${htmlFor}-hint`
      : undefined
  const controlElement = cloneElement(children, {
    id: children.props.id ?? htmlFor,
    'aria-describedby': children.props['aria-describedby'] ?? describedBy,
    'aria-invalid':
      children.props['aria-invalid'] ?? (error ? true : undefined),
  })

  return (
    <div className={cx('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {controlElement}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${htmlFor}-error`}>{error}</FieldError> : null}
    </div>
  )
}

export function FieldError({
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className="text-sm font-medium text-danger" {...props}>
      {children}
    </p>
  )
}

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={cx(control, className)} {...props} />
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(control, 'min-h-28 resize-y', className)}
      {...props}
    />
  )
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(control, className)} {...props} />
}

export function Checkbox({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cx(
        'size-5 shrink-0 rounded border accent-brand disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    />
  )
}
