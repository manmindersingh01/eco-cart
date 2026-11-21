'use client'

import { useState } from 'react'
import { AddressForm, AddressLines, type Address } from './address-form'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'

/** The buyer's saved addresses: add, change, make default, and delete. */
export function AddressBook({ initial }: { initial: Address[] }) {
  const [addresses, setAddresses] = useState(initial)
  // 'new', an address id being edited, or null.
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  async function reload() {
    const answer = await apiRequest<{ addresses: Address[] }>(
      '/api/account/addresses',
    )
    setAddresses(answer.addresses)
  }

  async function act(id: string, request: () => Promise<unknown>) {
    setBusy(id)
    setProblem(null)
    try {
      await request()
      await reload()
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? cause.message
          : 'That did not work. Check your connection and try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  async function saved() {
    setEditing(null)
    await reload()
  }

  return (
    <div className="grid gap-4">
      {problem ? <Notice tone="danger" title={problem} /> : null}

      {editing === 'new' ? (
        <Card className="grid gap-4">
          <h2 className="text-lg font-semibold">New address</h2>
          <AddressForm
            idPrefix="new-address"
            onSaved={() => void saved()}
            onCancel={() => setEditing(null)}
          />
        </Card>
      ) : (
        <div>
          <Button onClick={() => setEditing('new')}>Add an address</Button>
        </div>
      )}

      {addresses.length === 0 && editing !== 'new' ? (
        <EmptyState
          title="No saved addresses yet"
          description="Save an address once and choose it at checkout. Your first address becomes your default."
        />
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {addresses.map((address) => (
          <li key={address.id}>
            <Card className="grid h-full content-start gap-4">
              {editing === address.id ? (
                <>
                  <h2 className="text-lg font-semibold">Change address</h2>
                  <AddressForm
                    address={address}
                    idPrefix={`address-${address.id}`}
                    onSaved={() => void saved()}
                    onCancel={() => setEditing(null)}
                  />
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <AddressLines address={address} />
                    {address.isDefault ? (
                      <StatusBadge tone="success" className="shrink-0">
                        Default
                      </StatusBadge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setEditing(address.id)}
                      disabled={busy !== null}
                    >
                      Change
                    </Button>
                    {address.isDefault ? null : (
                      <Button
                        variant="quiet"
                        onClick={() =>
                          void act(address.id, () =>
                            apiRequest(`/api/account/addresses/${address.id}`, {
                              method: 'PATCH',
                              json: { isDefault: true },
                            }),
                          )
                        }
                        disabled={busy !== null}
                      >
                        Make default
                      </Button>
                    )}
                    <ConfirmationDialog
                      title="Delete this address?"
                      description={`The address for ${address.fullName} in ${address.city} is removed from your account. Orders already sent there keep their copy.`}
                      trigger="Delete"
                      triggerVariant="quiet"
                      confirmLabel="Delete address"
                      danger
                      triggerDisabled={busy !== null}
                      onConfirm={() =>
                        void act(address.id, () =>
                          apiRequest(`/api/account/addresses/${address.id}`, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    />
                  </div>
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
