'use client'

import { useId, useRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './button'

type ConfirmationDialogProps = {
  title: string
  description: string
  trigger: ReactNode
  triggerVariant?: ButtonProps['variant']
  confirmLabel: string
  onConfirm: () => void
  danger?: boolean
}

export function ConfirmationDialog({
  title,
  description,
  trigger,
  triggerVariant = 'secondary',
  confirmLabel,
  onConfirm,
  danger = false,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  function openDialog() {
    dialogRef.current?.showModal()
  }

  function closeDialog() {
    dialogRef.current?.close()
  }

  function restoreFocus() {
    triggerRef.current?.focus()
  }

  function confirm() {
    closeDialog()
    onConfirm()
  }

  return (
    <>
      <Button ref={triggerRef} variant={triggerVariant} onClick={openDialog}>
        {trigger}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={restoreFocus}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/55"
      >
        <div className="p-6">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <p id={descriptionId} className="mt-2 text-sm text-muted">
            {description}
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={closeDialog}>
              Cancel
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={confirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  )
}
