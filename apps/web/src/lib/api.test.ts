import {
  ConflictError,
  ForbiddenError,
  NotConfiguredError,
  NotFoundError,
  NotSignedInError,
  TooManyRequestsError,
  ValidationError,
} from '@ecokart/core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { handleErrors } from './api'

const failingWith = (error: Error) =>
  handleErrors(async () => {
    throw error
  })()

afterEach(() => {
  vi.useRealTimers()
})

describe('handleErrors', () => {
  test('answers each expected error with its status and message', async () => {
    const cases: [Error, number][] = [
      [new NotSignedInError(), 401],
      [new ForbiddenError('No'), 403],
      [new NotFoundError('Gone'), 404],
      [new ConflictError('Clash'), 409],
      [new TooManyRequestsError('Slow down'), 429],
      [new NotConfiguredError('Not yet'), 503],
    ]
    for (const [error, status] of cases) {
      const response = await failingWith(error)
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: error.message })
    }
  })

  test('lists the reasons of a validation error', async () => {
    const response = await failingWith(
      new ValidationError('Check the form', ['title is required']),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Check the form',
      issues: ['title is required'],
    })
  })

  test('says when to retry after a used-up limit, in whole seconds', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-11T18:29:58.200Z') })
    const response = await failingWith(
      new TooManyRequestsError('Today’s AI calls are used up', {
        resetAt: new Date('2026-10-11T18:30:00Z'),
      }),
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('2')
  })

  test('never tells a client to retry at once', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-11T18:30:00.500Z') })
    const response = await failingWith(
      new TooManyRequestsError('Slow down', {
        resetAt: new Date('2026-10-11T18:30:00Z'),
      }),
    )
    expect(response.headers.get('retry-after')).toBe('1')
  })

  test('has no Retry-After header when the reset time is unknown', async () => {
    const response = await failingWith(new TooManyRequestsError('Slow down'))
    expect(response.headers.has('retry-after')).toBe(false)
  })

  test('lets an unexpected error through, so Next.js answers 500', async () => {
    await expect(failingWith(new Error('bug'))).rejects.toThrow('bug')
  })
})
