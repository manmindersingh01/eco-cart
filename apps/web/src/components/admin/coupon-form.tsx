'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  couponIssue,
  couponPayload,
  couponValues,
  emptyCoupon,
  type CouponData,
  type CouponValues,
} from '@/lib/coupon-form'
import { useClientReady } from '@/lib/use-client-ready'

export function CouponForm({ initial }: { initial?: CouponData }) {
  const router = useRouter()
  const ready = useClientReady()
  const lock = useRef(false)
  const [current, setCurrent] = useState(initial)
  const [values, setValues] = useState(() =>
    initial ? couponValues(initial) : emptyCoupon,
  )
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const disabled = !ready || saving || refreshing || uncertain
  function change<K extends keyof CouponValues>(
    key: K,
    value: CouponValues[K],
  ) {
    setValues((old) => ({ ...old, [key]: value }))
  }
  return (
    <Card>
      <form
        autoComplete="off"
        aria-label={initial ? 'Edit coupon terms' : 'Create coupon'}
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          if (lock.current || disabled) return
          setProblem('')
          setSaved(false)
          const input = couponPayload(values, current)
          if (!input.ok) {
            setProblem(input.error)
            return
          }
          lock.current = true
          setSaving(true)
          try {
            const { coupon } = await apiRequest<{ coupon: CouponData }>(
              current
                ? `/api/admin/coupons/${current.id}`
                : '/api/admin/coupons',
              { method: current ? 'PATCH' : 'POST', json: input.value },
            )
            if (!current) {
              setValues(emptyCoupon)
              startTransition(() => router.push(`/admin/coupons/${coupon.id}`))
              return
            }
            setCurrent(coupon)
            setValues(couponValues(coupon))
            setSaved(true)
            startTransition(() => router.refresh())
          } catch (cause) {
            setUncertain(!(cause instanceof ApiError) || cause.status >= 500)
            setProblem(
              cause instanceof ApiError
                ? [
                    cause.message,
                    ...cause.issues.map((issue) =>
                      couponIssue(issue, values.discountType),
                    ),
                  ].join(' ')
                : 'The result could not be confirmed. Check the coupon list or reload this coupon before trying again.',
            )
          } finally {
            setSaving(false)
            lock.current = false
          }
        }}
      >
        <h2 className="text-lg font-semibold">
          {initial ? 'Edit coupon terms' : 'Create coupon'}
        </h2>
        <p className="text-sm text-muted">
          Amounts are in rupees and percentages, with up to two decimal places
          and no commas. Dates and times use India time (IST).
        </p>
        {saved ? (
          <Notice tone="success">Coupon terms were saved.</Notice>
        ) : null}
        {problem ? (
          <Notice tone="danger" title="Coupon could not be saved">
            <p>{problem}</p>
            {uncertain ? (
              <div className="mt-3 flex flex-wrap gap-3">
                <LinkButton href="/admin/coupons" variant="secondary">
                  Check coupon list
                </LinkButton>
                <Button
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  Reload coupon
                </Button>
              </div>
            ) : null}
          </Notice>
        ) : null}
        {initial ? (
          <p>
            Code: <strong>{initial.code}</strong>. The code cannot be changed.
          </p>
        ) : (
          <Field
            label="Coupon code"
            htmlFor="coupon-code"
            required
            hint="3 to 20 letters or digits. Saved in capitals."
          >
            <Input
              value={values.code}
              onChange={(event) => change('code', event.target.value)}
              required
              maxLength={20}
              disabled={disabled}
              autoCapitalize="characters"
            />
          </Field>
        )}
        <Field label="Description" htmlFor="coupon-description">
          <Textarea
            value={values.description}
            onChange={(event) => change('description', event.target.value)}
            maxLength={200}
            disabled={disabled}
          />
        </Field>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field label="Discount type" htmlFor="coupon-type">
            <Select
              value={values.discountType}
              disabled={disabled}
              onChange={(event) =>
                setValues((old) => ({
                  ...old,
                  discountType:
                    event.target.value === 'fixed' ? 'fixed' : 'percent',
                  discount: '',
                  cap: '',
                }))
              }
            >
              <option value="percent">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          <Field
            label={
              values.discountType === 'percent'
                ? 'Discount (%)'
                : 'Discount (₹)'
            }
            htmlFor="coupon-discount"
            required
            hint="Changing the discount type clears its value and cap."
          >
            <Input
              inputMode="decimal"
              value={values.discount}
              onChange={(event) => change('discount', event.target.value)}
              required
              disabled={disabled}
              maxLength={20}
            />
          </Field>
          <Field label="Minimum order (₹)" htmlFor="coupon-minimum" required>
            <Input
              inputMode="decimal"
              value={values.minimum}
              onChange={(event) => change('minimum', event.target.value)}
              required
              disabled={disabled}
              maxLength={20}
            />
          </Field>
          {values.discountType === 'percent' ? (
            <Field
              label="Maximum discount (₹)"
              htmlFor="coupon-cap"
              hint="Leave blank for no cap. Only percentage coupons have a cap."
            >
              <Input
                inputMode="decimal"
                value={values.cap}
                onChange={(event) => change('cap', event.target.value)}
                disabled={disabled}
                maxLength={20}
              />
            </Field>
          ) : null}
          <Field
            label="Total usage limit"
            htmlFor="coupon-usage"
            hint="Leave blank for no limit."
          >
            <Input
              inputMode="numeric"
              value={values.usage}
              onChange={(event) => change('usage', event.target.value)}
              disabled={disabled}
              maxLength={10}
            />
          </Field>
          <Field
            label="Per-buyer limit"
            htmlFor="coupon-per-buyer"
            hint="Leave blank for no limit."
          >
            <Input
              inputMode="numeric"
              value={values.perBuyer}
              onChange={(event) => change('perBuyer', event.target.value)}
              disabled={disabled}
              maxLength={10}
            />
          </Field>
          <Field
            label="Starts at (IST)"
            htmlFor="coupon-start"
            required={Boolean(initial)}
            hint={
              initial
                ? 'Dates are shown in India time.'
                : 'Leave blank to start when the coupon is created.'
            }
          >
            <Input
              type="datetime-local"
              className="min-w-0"
              value={values.start}
              onChange={(event) => change('start', event.target.value)}
              required={Boolean(initial)}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Ends at (IST)"
            htmlFor="coupon-end"
            hint="Leave blank for no end date."
          >
            <Input
              type="datetime-local"
              className="min-w-0"
              value={values.end}
              onChange={(event) => change('end', event.target.value)}
              disabled={disabled}
            />
          </Field>
        </div>
        {!initial ? (
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(event) => change('active', event.target.checked)}
              disabled={disabled}
              className="size-5 accent-brand"
            />
            Enabled on creation
          </label>
        ) : null}
        <div>
          <Button type="submit" disabled={disabled}>
            {saving
              ? 'Saving...'
              : initial
                ? 'Save coupon terms'
                : 'Create coupon'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
