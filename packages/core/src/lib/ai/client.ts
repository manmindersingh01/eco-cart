import { z } from 'zod'
import { describeIssues } from '../validation.ts'

/*
 * The one HTTP client every AI call goes through (design doc 3.2, backend
 * spec step 17). It speaks the OpenAI-compatible format that OpenRouter,
 * DeepSeek, and most other providers accept, so moving to another provider
 * or model is a configuration change. No vendor SDK is used anywhere.
 */

export interface AiEndpoint {
  /** For example https://openrouter.ai/api/v1. */
  baseUrl: string
  apiKey: string
}

/** What a call used, added up over every try. */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  /** As the provider reports it (OpenRouter: US dollars); null when it reports none. */
  costUsd: number | null
}

export const NO_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: null,
}

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd:
      a.costUsd === null && b.costUsd === null
        ? null
        : (a.costUsd ?? 0) + (b.costUsd ?? 0),
  }
}

/** The `usage` object of a chat or embeddings response. */
export const usageSchema = z
  .object({
    prompt_tokens: z.number().nonnegative(),
    completion_tokens: z.number().nonnegative().optional(),
    // OpenRouter only; DeepSeek direct reports tokens but no cost.
    cost: z.number().nonnegative().optional(),
  })
  .transform((usage): AiUsage => ({
    inputTokens: Math.round(usage.prompt_tokens),
    outputTokens: Math.round(usage.completion_tokens ?? 0),
    costUsd: usage.cost ?? null,
  }))

/** A model's checked answer and what it cost. */
export interface ModelReply<T> {
  value: T
  usage: AiUsage
}

export const DEFAULT_TIMEOUT_MS = 60_000

export interface AiRequestOptions {
  /** Gives up after this long; request-time paths use a few seconds. */
  timeoutMs?: number
}

/**
 * The provider could not be reached, did not answer in time, answered with
 * an error, or sent something unreadable. `usage` holds what earlier tries
 * of the same call used. The message never contains the key or the prompt.
 */
export class AiProviderError extends Error {
  override name = 'AiProviderError'
  readonly status: number | undefined
  readonly usage: AiUsage
  constructor(
    message: string,
    options: { status?: number; usage?: AiUsage; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.status = options.status
    this.usage = options.usage ?? NO_USAGE
  }
}

/** The model answered twice, and neither answer could be used. */
export class AiReplyError extends Error {
  override name = 'AiReplyError'
  readonly usage: AiUsage
  /** What was wrong with each answer, in plain words. */
  readonly problems: string[]
  constructor(message: string, usage: AiUsage, problems: string[]) {
    super(message)
    this.usage = usage
    this.problems = problems
  }
}

/** What a failed call used before it failed, if anything. */
export const usageOfFailure = (error: unknown): AiUsage =>
  error instanceof AiProviderError || error instanceof AiReplyError
    ? error.usage
    : NO_USAGE

export interface AiClient {
  /** Recorded on every `ai_requests` row, for example `openrouter`. */
  readonly provider: string
  /** Posts `body` and returns the response checked against `schema`. */
  post<S extends z.ZodType>(
    path: '/chat/completions' | '/embeddings',
    body: object,
    schema: S,
    options?: AiRequestOptions,
  ): Promise<z.output<S>>
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** True for addresses only this computer can reach. */
export const isLocalHost = (host: string): boolean =>
  LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.test')

/** The provider's short name, from the endpoint's address. */
export function providerName(baseUrl: string): string {
  const host = new URL(baseUrl).hostname
  const isOrUnder = (domain: string) =>
    host === domain || host.endsWith(`.${domain}`)
  if (isOrUnder('openrouter.ai')) return 'openrouter'
  if (isOrUnder('deepseek.com')) return 'deepseek'
  if (isLocalHost(host)) return 'local'
  return host
}

const errorBody = z.object({
  error: z.object({ message: z.string().optional() }).loose(),
})

// Provider error texts are short; anything longer is cut, so a provider that
// echoes the request can never fill the log with it.
const MAX_PROVIDER_TEXT = 300

function providerText(body: unknown): string | null {
  const parsed = errorBody.safeParse(body)
  const message = parsed.success ? parsed.data.error.message?.trim() : null
  if (!message) return null
  return message.length > MAX_PROVIDER_TEXT
    ? `${message.slice(0, MAX_PROVIDER_TEXT)}...`
    : message
}

export function createAiClient(
  endpoint: AiEndpoint,
  fetchImpl: typeof fetch = fetch,
): AiClient {
  const baseUrl = endpoint.baseUrl.replace(/\/+$/, '')
  return {
    provider: providerName(baseUrl),

    async post(path, body, schema, options = {}) {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let response: Response
      let text: string
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${endpoint.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
        text = await response.text()
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new AiProviderError(
            `The AI provider did not answer within ${timeoutMs / 1000} seconds`,
            { cause: error },
          )
        }
        const reason = error instanceof Error ? error.message : String(error)
        throw new AiProviderError(
          `The AI provider could not be reached: ${reason}`,
          { cause: error },
        )
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }

      if (!response.ok) {
        const reason = providerText(parsed) ?? response.statusText
        throw new AiProviderError(
          `The AI provider answered ${response.status}${reason ? `: ${reason}` : ''}`,
          { status: response.status },
        )
      }
      if (parsed === undefined) {
        throw new AiProviderError(
          'The AI provider sent a response that is not JSON',
          { status: response.status },
        )
      }
      // OpenRouter reports some failures, such as every upstream provider
      // being down, as an error object in a 200 response.
      const failure = providerText(parsed)
      if (failure !== null) {
        throw new AiProviderError(`The AI provider failed: ${failure}`, {
          status: response.status,
        })
      }
      const result = schema.safeParse(parsed)
      if (!result.success) {
        throw new AiProviderError(
          `The AI provider sent a response in an unexpected shape: ${describeIssues(result.error).join('; ')}`,
          { status: response.status },
        )
      }
      return result.data
    },
  }
}
