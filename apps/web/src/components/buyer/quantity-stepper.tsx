'use client'

import { useState } from 'react'
import { IconButton } from '@/components/ui/button'

/**
 * − and + around a number the buyer can also type. A typed number is sent
 * when the box loses focus or on Enter, kept between `min` and `max`, so a
 * buyer typing 12 does not send 1 first.
 */
export function QuantityStepper({
  id,
  label,
  value,
  min,
  max,
  disabled = false,
  onChange,
}: {
  id: string
  /** For screen readers, for example "Quantity of Bamboo Straw". */
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (quantity: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const ceiling = Math.max(min, max)

  function commit(text: string) {
    setDraft(null)
    if (!/^\d+$/.test(text)) return
    const wanted = Math.min(ceiling, Math.max(min, Number(text)))
    if (wanted !== value) onChange(wanted)
  }

  return (
    <div className="flex items-center gap-1">
      <IconButton
        variant="secondary"
        aria-label={`One fewer, ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </IconButton>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value.trim())}
        onBlur={(event) => commit(event.target.value.trim())}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value.trim())
        }}
        className="min-h-11 w-12 rounded-lg border bg-surface px-1 py-2 text-center text-sm disabled:opacity-55"
      />
      <IconButton
        variant="secondary"
        aria-label={`One more, ${label}`}
        disabled={disabled || value >= ceiling}
        onClick={() => onChange(Math.min(ceiling, value + 1))}
      >
        +
      </IconButton>
    </div>
  )
}
