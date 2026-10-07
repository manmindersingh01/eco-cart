import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, apiRequest } from './api-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  test('sends and parses JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ saved: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      apiRequest<{ saved: boolean }>('/api/example', {
        method: 'POST',
        json: { name: 'EcoKart' },
      }),
    ).resolves.toEqual({ saved: true })

    const options = fetchMock.mock.calls[0]?.[1]
    expect(new Headers(options?.headers).get('content-type')).toBe(
      'application/json',
    )
    expect(options?.body).toBe('{"name":"EcoKart"}')
  })

  test('returns undefined for a 204 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
    )

    await expect(
      apiRequest<void>('/api/example', { method: 'DELETE' }),
    ).resolves.toBeUndefined()
  })

  test('preserves the error summary, issues, and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'Those product details are not valid',
            issues: ['pricePaise must be positive'],
          }),
          { status: 400 },
        ),
      ),
    )

    const error = await apiRequest('/api/example').catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      message: 'Those product details are not valid',
      status: 400,
      issues: ['pricePaise must be positive'],
    })
  })

  test('uses a plain fallback for an invalid error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('<html>Unavailable</html>', { status: 503 }),
        ),
    )

    await expect(apiRequest('/api/example')).rejects.toMatchObject({
      message: 'The request failed with status 503. Please try again.',
      status: 503,
      issues: [],
    })
  })

  test('uses a plain fallback for an empty error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 500 })),
    )

    await expect(apiRequest('/api/example')).rejects.toMatchObject({
      message: 'The request failed with status 500. Please try again.',
      status: 500,
      issues: [],
    })
  })

  test('passes an abort signal to fetch', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await apiRequest('/api/search', { signal: controller.signal })

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    })
  })
})
