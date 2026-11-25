'use client'

import type { ReturnPhotoView, ReturnPhotoUpload } from '@ecokart/core'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatStatusLabel } from '@/lib/format'

const reasons = [
  'damaged',
  'defective',
  'wrong_item',
  'not_as_described',
  'missing_parts',
  'no_longer_needed',
  'other',
]
const problemText = (cause: unknown) =>
  cause instanceof ApiError
    ? [cause.message, ...cause.issues].join(' ')
    : 'Check your connection and try again. Your form has been kept.'

export function ReturnRequest({ lineId }: { lineId: string }) {
  const prefix = useId()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('damaged')
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<ReturnPhotoView[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [success, setSuccess] = useState(false)
  const lock = useRef(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (
      !open ||
      success ||
      !photos.some((photo) => photo.status === 'processing')
    )
      return undefined
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        for (const photo of photos.filter(
          (item) => item.status === 'processing',
        )) {
          const result = await apiRequest<{ photo: ReturnPhotoView }>(
            `/api/account/return-photos/${photo.id}`,
            { signal: abort.signal, cache: 'no-store' },
          )
          if (abort.signal.aborted) return
          setPhotos((current) =>
            current.map((item) => (item.id === photo.id ? result.photo : item)),
          )
        }
        setPollError('')
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2000)
      } catch (cause) {
        if (!abort.signal.aborted) setPollError(problemText(cause))
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [photos, open, success])

  async function uploadPhoto(file: File) {
    if (lock.current) return
    lock.current = true
    setUploading(true)
    setError('')
    const abort = new AbortController()
    controller.current = abort
    try {
      const { upload } = await apiRequest<{ upload: ReturnPhotoUpload }>(
        '/api/account/return-photos/uploads',
        {
          method: 'POST',
          json: { contentType: file.type, size: file.size },
          signal: abort.signal,
        },
      )
      const form = new FormData()
      for (const [key, value] of Object.entries(upload.fields))
        form.append(key, value)
      form.append('file', file)
      const stored = await fetch(upload.url, {
        method: 'POST',
        body: form,
        signal: abort.signal,
      })
      if (!stored.ok) throw new Error('Upload failed')
      const { photo } = await apiRequest<{ photo: ReturnPhotoView }>(
        '/api/account/return-photos',
        {
          method: 'POST',
          json: { uploadKey: upload.key },
          signal: abort.signal,
        },
      )
      setPhotos((current) => [...current, photo])
    } catch (cause) {
      if (!abort.signal.aborted) setError(problemText(cause))
    } finally {
      lock.current = false
      setUploading(false)
    }
  }
  const pending = uploading || sending || refreshing
  if (success)
    return (
      <Notice tone="success" title="Return requested">
        Your request has been sent for review.
      </Notice>
    )
  if (!open)
    return (
      <Button
        variant="secondary"
        className="mt-3 w-fit"
        onClick={() => setOpen(true)}
      >
        Request a return
      </Button>
    )
  return (
    <form
      className="mt-3 grid gap-3 border-t pt-4"
      aria-label="Request a return"
      onSubmit={async (event) => {
        event.preventDefault()
        if (
          lock.current ||
          pending ||
          photos.some((photo) => photo.status !== 'ready')
        )
          return
        lock.current = true
        setSending(true)
        setError('')
        try {
          await apiRequest('/api/account/returns', {
            method: 'POST',
            json: {
              orderItemId: lineId,
              ...(quantity ? { quantity: Number(quantity) } : {}),
              reasonCode: reason,
              ...(text.trim() ? { reasonText: text.trim() } : {}),
              photoIds: photos.map((photo) => photo.id),
            },
          })
          setSuccess(true)
          startTransition(() => router.refresh())
        } catch (cause) {
          setError(problemText(cause))
        } finally {
          lock.current = false
          setSending(false)
        }
      }}
    >
      <h4 className="font-semibold">Request a return</h4>
      {error ? (
        <Notice tone="danger" title="Return could not be sent">
          {error}
        </Notice>
      ) : null}
      <Field
        label="Return quantity"
        htmlFor={`${prefix}-quantity`}
        hint="Leave blank to return everything still returnable. The server checks the quantity and return window."
      >
        <Input
          id={`${prefix}-quantity`}
          type="number"
          min={1}
          max={1000}
          step={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          disabled={pending}
        />
      </Field>
      <Field label="Return reason" htmlFor={`${prefix}-reason`}>
        <Select
          id={`${prefix}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
        >
          {reasons.map((value) => (
            <option key={value} value={value}>
              {formatStatusLabel(value)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Reason details"
        htmlFor={`${prefix}-text`}
        required={reason === 'other'}
        hint={
          reason === 'other'
            ? 'Explain why you want to return this item.'
            : 'Optional details.'
        }
      >
        <Textarea
          id={`${prefix}-text`}
          required={reason === 'other'}
          maxLength={1000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={pending}
        />
      </Field>
      <Field
        label="Return photo (optional)"
        htmlFor={`${prefix}-photo`}
        hint="Up to 5 photos, 10 MB each. JPEG, PNG, WebP or AVIF. Wait until each photo is ready."
      >
        <Input
          id={`${prefix}-photo`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={pending || photos.length >= 5}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void uploadPhoto(file)
          }}
        />
      </Field>
      {uploading ? <output>Uploading photo...</output> : null}
      <ul className="grid gap-2">
        {photos.map((photo, index) => (
          <li key={photo.id} className="grid gap-1 text-sm">
            <output>
              Photo {index + 1}: {formatStatusLabel(photo.status)}
              {photo.failureReason ? ` - ${photo.failureReason}` : ''}
            </output>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                setPhotos((current) =>
                  current.filter((item) => item.id !== photo.id),
                )
              }
            >
              Remove photo {index + 1}
            </Button>
          </li>
        ))}
      </ul>
      {pollError ? (
        <Notice tone="danger" title="Photo status unavailable">
          {pollError}
          <Button
            variant="secondary"
            onClick={() => {
              setPollError('')
              setPhotos((current) => [...current])
            }}
          >
            Retry photo check
          </Button>
        </Notice>
      ) : null}
      <p className="text-sm text-muted">
        Remove failed photos or upload replacements before sending.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={
            pending ||
            photos.some((photo) => photo.status !== 'ready') ||
            (reason === 'other' && !text.trim())
          }
        >
          {sending ? 'Sending request...' : 'Send return request'}
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Close form
        </Button>
      </div>
    </form>
  )
}
