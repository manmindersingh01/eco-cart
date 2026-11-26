'use client'

import type { SettlementStatementView } from '@ecokart/core'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PrivateFileDownload } from '@/components/ui/private-file-download'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatIndianDate, formatInr } from '@/lib/format'

export function StatementStatus({
  initial,
}: {
  initial: SettlementStatementView
}) {
  const [item, setItem] = useState(initial)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (item.status !== 'processing' || !checking) return undefined
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const { statement } = await apiRequest<{
          statement: SettlementStatementView
        }>(`/api/settlement-statements/${item.id}?as=seller`, {
          signal: abort.signal,
          cache: 'no-store',
        })
        if (abort.signal.aborted) return
        setItem(statement)
        if (statement.status === 'processing')
          timer = setTimeout(() => void poll(), 2000)
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(
            cause instanceof ApiError
              ? cause.message
              : 'The statement status could not be checked. Try again.',
          )
          setChecking(false)
        }
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [item.id, item.status, checking])
  return (
    <Card className="grid min-w-0 gap-3" data-statement-id={item.id}>
      <h3 className="font-semibold">
        {formatIndianDate(`${item.from}T00:00:00+05:30`)} to{' '}
        {formatIndianDate(`${item.to}T00:00:00+05:30`)}
      </h3>
      <div>
        <StatusBadge
          tone={
            item.status === 'failed'
              ? 'danger'
              : item.status === 'ready'
                ? 'success'
                : 'neutral'
          }
        >
          {item.status === 'processing'
            ? 'Being prepared'
            : item.status === 'ready'
              ? 'Ready'
              : 'Failed'}
        </StatusBadge>
      </div>
      <p className="text-sm text-muted">
        Requested {formatIndianDate(item.requestedAt, { includeTime: true })}
      </p>
      {item.status === 'processing' ? (
        <p className="text-sm">
          The worker is preparing your statement. Its status updates while this
          page is open.
        </p>
      ) : null}
      {item.status === 'failed' ? (
        <Notice tone="danger" title="Statement failed">
          {item.failureReason ?? 'The statement could not be made.'} Request a
          new statement after the problem is resolved.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger" title="Statement status unavailable">
          <p>{error}</p>
          <Button
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setError('')
              setChecking(true)
            }}
          >
            Retry status check
          </Button>
        </Notice>
      ) : null}
      {item.status === 'ready' ? (
        <>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted">Opening balance</dt>
              <dd>
                {item.openingBalancePaise === null
                  ? 'Unavailable'
                  : formatInr(item.openingBalancePaise)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Closing balance</dt>
              <dd>
                {item.closingBalancePaise === null
                  ? 'Unavailable'
                  : formatInr(item.closingBalancePaise)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Entries</dt>
              <dd>{item.entryCount ?? 'Unavailable'}</dd>
            </div>
          </dl>
          {item.madeAt ? (
            <p className="text-sm text-muted">
              Made {formatIndianDate(item.madeAt, { includeTime: true })}. Later
              entries are not included.
            </p>
          ) : null}
          <PrivateFileDownload
            href={`/api/settlement-statements/${item.id}/file?as=seller`}
            label="Download CSV"
            unavailableTitle="Statement unavailable"
            help="Refresh the page and try again. Request a new statement if this file stays unavailable."
          />
        </>
      ) : null}
    </Card>
  )
}
