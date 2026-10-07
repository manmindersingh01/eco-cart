'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form-controls'
import { Notice } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'
import { destinationForRole, type CurrentAccount } from '@/lib/auth-routing'

const RESEND_COOLDOWN_SECONDS = 30

type SignInFormProps = {
  returnTo: string | null
  reason: string | null
}

type PendingAction = 'sending' | 'verifying' | 'redirecting' | null

function authErrorMessage(error: {
  status: number
  message?: string
  code?: string
}): string {
  if (error.status === 429) {
    return 'Too many attempts. Wait a minute before trying again.'
  }
  if (error.status >= 500) {
    return 'Sign-in is temporarily unavailable. Please try again shortly.'
  }
  if (error.code === 'BANNED_USER') {
    return 'This account cannot sign in. Contact an administrator for help.'
  }
  return error.message || 'That code is invalid or has expired.'
}

export function SignInForm({ returnTo, reason }: SignInFormProps) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const otpInput = useRef<HTMLInputElement>(null)
  const hasChangedStep = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = window.setTimeout(
      () => setCooldown((seconds) => Math.max(0, seconds - 1)),
      1_000,
    )
    return () => window.clearTimeout(timer)
  }, [cooldown])

  useEffect(() => {
    if (hasChangedStep.current) {
      if (step === 'code') otpInput.current?.focus()
      else emailInput.current?.focus()
    } else {
      hasChangedStep.current = true
    }
  }, [step])

  async function sendCode(): Promise<boolean> {
    const normalisedEmail = email.trim().toLowerCase()
    setPending('sending')
    setError(null)
    setMessage(null)
    let result
    try {
      result = await authClient.emailOtp.sendVerificationOtp({
        email: normalisedEmail,
        type: 'sign-in',
      })
    } catch {
      setPending(null)
      setError('Sign-in is temporarily unavailable. Please try again shortly.')
      return false
    }
    setPending(null)

    if (result.error) {
      setError(authErrorMessage(result.error))
      return false
    }

    setEmail(normalisedEmail)
    setStep('code')
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setMessage(`A six-digit code was sent to ${normalisedEmail}.`)
    return true
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendCode()
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending('verifying')
    setError(null)
    setMessage(null)

    let result
    try {
      result = await authClient.signIn.emailOtp({
        email,
        otp,
      })
    } catch {
      setPending(null)
      setError('Sign-in is temporarily unavailable. Please try again shortly.')
      return
    }
    if (result.error) {
      setPending(null)
      setError(authErrorMessage(result.error))
      return
    }

    setPending('redirecting')
    try {
      const account = await apiRequest<CurrentAccount>('/api/me')
      window.location.assign(destinationForRole(account.role, returnTo))
    } catch (requestError) {
      setPending(null)
      if (requestError instanceof ApiError && requestError.status === 403) {
        try {
          await authClient.signOut()
          setError(requestError.message)
        } catch {
          setError(
            `${requestError.message} Use Sign out in the header to continue.`,
          )
        }
      } else {
        setError(
          'Signed in, but your account could not be loaded. Please try again.',
        )
      }
    }
  }

  async function resendCode() {
    if (cooldown > 0 || pending) return
    if (await sendCode()) {
      setMessage(`A new six-digit code was sent to ${email}.`)
    }
  }

  function changeEmail() {
    setStep('email')
    setOtp('')
    setError(null)
    setMessage(null)
    setCooldown(0)
  }

  return (
    <div className="grid gap-5">
      {reason === 'session-ended' ? (
        <Notice title="Your session is no longer active" tone="warning">
          Sign in again. If your seller account was suspended, contact an
          administrator.
        </Notice>
      ) : null}

      {error ? (
        <Notice title="Sign-in failed" tone="danger">
          {error}
        </Notice>
      ) : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {step === 'email' ? (
        <form
          className="grid gap-5"
          aria-busy={pending === 'sending'}
          onSubmit={submitEmail}
        >
          <Field label="Email address" htmlFor="email" required>
            <Input
              ref={emailInput}
              id="email"
              name="email"
              type="email"
              value={email}
              autoComplete="email"
              required
              disabled={pending !== null}
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={pending !== null}>
            {pending === 'sending' ? 'Sending code...' : 'Send sign-in code'}
          </Button>
          <p className="text-sm text-muted">
            We send the same response whether or not an account already exists.
          </p>
        </form>
      ) : (
        <form
          className="grid gap-5"
          aria-busy={pending !== null}
          onSubmit={submitCode}
        >
          <div>
            <p className="text-sm text-muted">Code sent to</p>
            <p className="font-medium break-all">{email}</p>
          </div>
          <Field
            label="Six-digit code"
            htmlFor="otp"
            hint="The code expires after five minutes and allows three attempts."
            required
          >
            <Input
              ref={otpInput}
              id="otp"
              name="otp"
              value={otp}
              autoComplete="one-time-code"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              disabled={pending !== null}
              placeholder="000000"
              onChange={(event) =>
                setOtp(event.target.value.replaceAll(/\D/g, '').slice(0, 6))
              }
            />
          </Field>
          <Button type="submit" disabled={pending !== null || otp.length !== 6}>
            {pending === 'verifying'
              ? 'Checking code...'
              : pending === 'redirecting'
                ? 'Signed in. Redirecting...'
                : 'Sign in'}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="quiet"
              onClick={changeEmail}
              disabled={pending !== null}
            >
              Change email
            </Button>
            <Button
              variant="quiet"
              onClick={resendCode}
              disabled={pending !== null || cooldown > 0}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
