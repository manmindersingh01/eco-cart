'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { authClient } from '@/lib/auth-client'
import { announceAccountUpdate } from '@/lib/account-events'
import { useClientReady } from '@/lib/use-client-ready'

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter()
  const ready = useClientReady()
  const lock = useRef(false)
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [sessionEnded, setSessionEnded] = useState(false)
  const [saved, setSaved] = useState(false)
  return (
    <Card className="max-w-2xl">
      <form
        autoComplete="off"
        aria-label="Edit your display name"
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!ready || lock.current || refreshing || sessionEnded) return
          if (!name.trim()) {
            setError('Enter your name.')
            setSaved(false)
            return
          }
          lock.current = true
          setSaving(true)
          setError('')
          setSaved(false)
          try {
            const result = await authClient.updateUser({ name: name.trim() })
            if (result.error) {
              if (result.error.status === 401) {
                setSessionEnded(true)
                setError(
                  'Your session has ended. Sign in again to save your name.',
                )
              } else
                setError(
                  result.error.status === 429
                    ? 'Too many attempts. Wait a minute and try again.'
                    : result.error.message ||
                        'Your name could not be saved. Try again.',
                )
              return
            }
            setName(name.trim())
            setSaved(true)
            announceAccountUpdate()
            startTransition(() => router.refresh())
          } catch {
            setError(
              'The save could not be confirmed. Reload your profile to check your name before trying again.',
            )
          } finally {
            setSaving(false)
            lock.current = false
          }
        }}
      >
        <h2 className="text-lg font-semibold">Display name</h2>
        <p className="text-sm text-muted">
          Choose the name shown on your account.
        </p>
        {saved ? <Notice tone="success">Your name was saved.</Notice> : null}
        {error ? (
          <Notice tone="danger" title="Name could not be saved">
            <p>{error}</p>
            {sessionEnded ? (
              <LinkButton className="mt-3" href="/sign-in?returnTo=%2Faccount">
                Sign in again
              </LinkButton>
            ) : null}
          </Notice>
        ) : null}
        <Field label="Your name" htmlFor="profile-name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoComplete="name"
            disabled={!ready || saving || refreshing || sessionEnded}
          />
        </Field>
        <div>
          <Button
            type="submit"
            disabled={!ready || saving || refreshing || sessionEnded}
          >
            {saving ? 'Saving...' : 'Save name'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
