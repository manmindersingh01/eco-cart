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
  phoneEnabled: boolean
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
  if (error.code === 'OTP_EXPIRED' || error.code === 'OTP_NOT_FOUND') {
    return 'That code has expired. Request a new code.'
  }
  if (error.code === 'TOO_MANY_ATTEMPTS') {
    return 'Too many incorrect codes. Request a new code.'
  }
  if (error.code === 'INVALID_OTP') {
    return 'That code is invalid. Check it and try again.'
  }
  return error.message || 'That code is invalid or has expired.'
}

export function SignInForm({
  returnTo,
  reason,
  phoneEnabled,
}: SignInFormProps) {
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [phone, setPhone] = useState('')
  const actionLock = useRef(false)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const phoneInput = useRef<HTMLInputElement>(null)
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
      else if (method === 'phone') phoneInput.current?.focus()
      else emailInput.current?.focus()
    } else {
      hasChangedStep.current = true
      setReady(true)
    }
  }, [step, method])

  async function sendCode(): Promise<boolean> {
    if (!ready || actionLock.current) return false
    const normalisedEmail = email.trim().toLowerCase()
    const digits = phone.replaceAll(/[\s()-]/g, '')
    const normalisedPhone = /^\d{10}$/.test(digits) ? `+91${digits}` : digits
    if (method === 'phone' && !/^\+91[6-9]\d{9}$/.test(normalisedPhone)) {
      setError(
        'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9, or use +91 followed by that number.',
      )
      return false
    }
    actionLock.current = true
    setPending('sending')
    setError(null)
    setMessage(null)
    let result
    try {
      result =
        method === 'phone'
          ? await authClient.phoneNumber.sendOtp({
              phoneNumber: normalisedPhone,
            })
          : await authClient.emailOtp.sendVerificationOtp({
              email: normalisedEmail,
              type: 'sign-in',
            })
    } catch {
      setPending(null)
      setError('Sign-in is temporarily unavailable. Please try again shortly.')
      return false
    } finally {
      actionLock.current = false
    }
    setPending(null)

    if (result.error) {
      setError(
        method === 'phone' && result.error.status === 404
          ? 'Phone sign-in is unavailable. Use email or try again later.'
          : authErrorMessage(result.error),
      )
      return false
    }

    setEmail(normalisedEmail)
    setPhone(normalisedPhone)
    setOtp('')
    setStep('code')
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setMessage(
      `A six-digit code was sent to ${method === 'phone' ? normalisedPhone : normalisedEmail}.`,
    )
    return true
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await sendCode()
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionLock.current) return
    actionLock.current = true
    setPending('verifying')
    setError(null)
    setMessage(null)

    let result
    try {
      result =
        method === 'phone'
          ? await authClient.phoneNumber.verify({
              phoneNumber: phone,
              code: otp,
            })
          : await authClient.signIn.emailOtp({
              email,
              otp,
            })
    } catch {
      setPending(null)
      setError('Sign-in is temporarily unavailable. Please try again shortly.')
      return
    } finally {
      actionLock.current = false
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
      setMessage(
        `A new six-digit code was sent to ${method === 'phone' ? phone : email}.`,
      )
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
          {phoneEnabled ? (
            <Button
              variant="secondary"
              onClick={() => {
                setMethod(method === 'email' ? 'phone' : 'email')
                setOtp('')
                setError(null)
                setMessage(null)
              }}
              disabled={!ready || pending !== null}
            >
              {method === 'email' ? 'Sign in with phone' : 'Sign in with email'}
            </Button>
          ) : null}
          {method === 'email' ? (
            <Field label="Email address" htmlFor="email" required>
              <Input
                ref={emailInput}
                id="email"
                name="email"
                type="email"
                value={email}
                autoComplete="email"
                required
                disabled={!ready || pending !== null}
                placeholder="you@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          ) : (
            <Field
              label="Mobile number"
              htmlFor="phone"
              required
              hint="Use your 10-digit Indian mobile number, or include +91."
            >
              <Input
                ref={phoneInput}
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                required
                disabled={!ready || pending !== null}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={24}
              />
            </Field>
          )}
          <Button type="submit" disabled={!ready || pending !== null}>
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
            <p className="font-medium break-all">
              {method === 'phone' ? phone : email}
            </p>
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
              {method === 'phone' ? 'Change phone number' : 'Change email'}
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
