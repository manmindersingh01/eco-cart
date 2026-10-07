export type ApiIssue = string

type ApiErrorBody = {
  error: string
  issues?: ApiIssue[]
}

export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly status: number
  readonly issues: ApiIssue[]

  constructor(message: string, status: number, issues: ApiIssue[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  json?: unknown
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  return (
    'error' in value &&
    typeof value.error === 'string' &&
    (!('issues' in value) ||
      value.issues === undefined ||
      (Array.isArray(value.issues) &&
        value.issues.every((issue) => typeof issue === 'string')))
  )
}

function parseJson(text: string): unknown {
  if (!text) return undefined

  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export function apiRequest<T>(
  input: RequestInfo | URL,
  options?: ApiRequestOptions,
): Promise<T>
export async function apiRequest(
  input: RequestInfo | URL,
  { headers, json, ...init }: ApiRequestOptions = {},
): Promise<unknown> {
  const requestHeaders = new Headers(headers)
  if (json !== undefined && !requestHeaders.has('content-type')) {
    requestHeaders.set('content-type', 'application/json')
  }

  const response = await fetch(input, {
    ...init,
    headers: requestHeaders,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  })

  if (response.status === 204) return undefined

  const parsed = parseJson(await response.text())
  if (!response.ok) {
    if (isApiErrorBody(parsed)) {
      throw new ApiError(parsed.error, response.status, parsed.issues ?? [])
    }

    throw new ApiError(
      `The request failed with status ${response.status}. Please try again.`,
      response.status,
    )
  }

  if (parsed === undefined) {
    throw new ApiError(
      'The server returned an invalid response.',
      response.status,
    )
  }

  return parsed
}
