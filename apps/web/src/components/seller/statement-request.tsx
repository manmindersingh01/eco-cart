'use client'

import type { SettlementStatementView } from '@ecokart/core'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { StatementStatus } from './statement-status'
import { Button } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'

export function StatementRequest({ visibleIds }: { visibleIds: string[] }) {
  const router = useRouter()
  const ready = useClientReady()
  const lock = useRef(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState('')
  const [created, setCreated] = useState<SettlementStatementView | null>(null)
  return (
    <div className="grid gap-3">
      <Card>
        <form
          autoComplete="off"
          aria-label="Request a settlement statement"
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!ready || lock.current || refreshing) return
            lock.current = true
            setSaving(true)
            setProblem('')
            try {
              const { statement } = await apiRequest<{
                statement: SettlementStatementView
              }>('/api/seller/settlement-statements', {
                method: 'POST',
                json: { from, to },
              })
              setCreated(statement)
            } catch (cause) {
              setProblem(
                cause instanceof ApiError
                  ? [
                      cause.message,
                      ...cause.issues.map((issue) =>
                        issue
                          .replace(
                            /^from must not be after to$/,
                            'The start date must not be after the end date.',
                          )
                          .replace(
                            /^to must not be after today$/,
                            'The end date must not be after today.',
                          ),
                      ),
                    ].join(' ')
                  : 'The result could not be confirmed. Check statement history before requesting another file.',
              )
            } finally {
              startTransition(() => router.refresh())
              setSaving(false)
              lock.current = false
            }
          }}
        >
          <h3 className="font-semibold">Request a statement</h3>
          <p className="text-sm text-muted">
            A CSV file of your money history with opening and closing balances.
            Dates use India time and include both ends. A statement can cover at
            most 366 days.
          </p>
          {problem ? (
            <Notice tone="danger" title="Statement could not be requested">
              {problem}
            </Notice>
          ) : null}
          {created ? (
            <Notice tone="success" title="Statement requested">
              Check its status below. A file is available only when it is ready.
            </Notice>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date" htmlFor="statement-from" required>
              <Input
                type="date"
                id="statement-from"
                required
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                disabled={!ready || saving || refreshing}
              />
            </Field>
            <Field label="End date" htmlFor="statement-to" required>
              <Input
                type="date"
                id="statement-to"
                required
                value={to}
                onChange={(event) => setTo(event.target.value)}
                disabled={!ready || saving || refreshing}
              />
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={!ready || saving || refreshing}>
              {saving ? 'Requesting...' : 'Request statement'}
            </Button>
          </div>
        </form>
      </Card>
      {created && !visibleIds.includes(created.id) ? (
        <StatementStatus key={created.id} initial={created} />
      ) : null}
    </div>
  )
}
