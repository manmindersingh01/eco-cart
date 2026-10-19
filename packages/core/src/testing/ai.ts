import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AiSettings } from '../lib/ai/index.ts'

/*
 * A local stand-in for OpenRouter, so AI code is tested without a key or the
 * network (backend spec step 17). It answers in OpenRouter's format with the
 * replies a test queues, refuses a wrong key the way OpenRouter does, and
 * records every request so a test can check what was sent.
 */

export const FAKE_AI_KEY = 'development-only-fake-ai-key'

export interface FakeAiRequest {
  path: string
  authorization: string | undefined
  body: unknown
}

export interface FakeAiReply {
  status?: number
  /** Sent as JSON. */
  body?: unknown
  /** Sent as it is, for a response that is not JSON. */
  rawBody?: string
  /** Waits this long before answering, to test time limits. */
  delayMs?: number
}

export interface FakeAiServer {
  /** The base URL, like https://openrouter.ai/api/v1. */
  url: string
  /** Every request so far, oldest first. */
  requests: FakeAiRequest[]
  /** Replies for the next requests, in order, whatever their path. */
  queue(...replies: FakeAiReply[]): void
  /** AI settings that point every model at this server. */
  settings(overrides?: Partial<AiSettings>): AiSettings
  close(): Promise<void>
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  request.setEncoding('utf8')
  let text = ''
  for await (const chunk of request) text += String(chunk)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function sendJson(response: ServerResponse, status: number, json: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(json))
}

export async function startFakeAiServer(): Promise<FakeAiServer> {
  const requests: FakeAiRequest[] = []
  const replies: FakeAiReply[] = []

  const server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request)
      const path = (request.url ?? '').replace(/^\/api\/v1/, '')
      requests.push({
        path,
        authorization: request.headers.authorization,
        body,
      })

      if (request.headers.authorization !== `Bearer ${FAKE_AI_KEY}`) {
        sendJson(response, 401, {
          error: { message: 'No auth credentials found', code: 401 },
        })
        return
      }
      const reply = replies.shift()
      if (!reply) {
        sendJson(response, 500, {
          error: {
            message: `The fake AI server has no reply queued for ${path}`,
          },
        })
        return
      }
      if (reply.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
      }
      if (reply.rawBody !== undefined) {
        response.writeHead(reply.status ?? 200, {
          'content-type': 'text/plain',
        })
        response.end(reply.rawBody)
        return
      }
      sendJson(response, reply.status ?? 200, reply.body ?? {})
    })().catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : undefined)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The fake AI server is not listening on a port')
  }
  const url = `http://127.0.0.1:${address.port}/api/v1`

  return {
    url,
    requests,
    queue: (...next) => {
      replies.push(...next)
    },
    settings: (overrides = {}) => {
      const endpoint = { baseUrl: url, apiKey: FAKE_AI_KEY }
      return {
        chat: endpoint,
        embed: endpoint,
        chatModel: 'deepseek/deepseek-v4.1-flash',
        visionModel: 'deepseek/deepseek-v4.1-flash',
        embedModel: 'voyageai/voyage-multimodal-3.5',
        embedDimensions: 1024,
        ...overrides,
      }
    },
    close: () =>
      new Promise((resolve, reject) => {
        // A test that timed out may leave a delayed reply open.
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

/** A chat completion whose answer is `content` (objects are sent as JSON text). */
export function fakeChatReply(
  content: unknown,
  options: {
    finishReason?: string
    inputTokens?: number
    outputTokens?: number
    /** Leave out for a provider that reports no cost, like DeepSeek direct. */
    costUsd?: number
  } = {},
): FakeAiReply {
  const inputTokens = options.inputTokens ?? 120
  const outputTokens = options.outputTokens ?? 40
  return {
    body: {
      id: `gen-${crypto.randomUUID()}`,
      object: 'chat.completion',
      model: 'deepseek/deepseek-v4.1-flash',
      choices: [
        {
          index: 0,
          finish_reason: options.finishReason ?? 'stop',
          message: {
            role: 'assistant',
            content:
              typeof content === 'string' ? content : JSON.stringify(content),
          },
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        ...(options.costUsd === undefined ? {} : { cost: options.costUsd }),
      },
    },
  }
}

/** An embeddings response with one vector per entry of `vectors`. */
export function fakeEmbeddingsReply(
  vectors: number[][],
  options: { inputTokens?: number; costUsd?: number } = {},
): FakeAiReply {
  const inputTokens = options.inputTokens ?? 8 * vectors.length
  return {
    body: {
      id: `gen-${crypto.randomUUID()}`,
      object: 'list',
      model: 'voyageai/voyage-multimodal-3.5',
      data: vectors.map((embedding, index) => ({
        object: 'embedding',
        embedding,
        index,
      })),
      usage: {
        prompt_tokens: inputTokens,
        total_tokens: inputTokens,
        ...(options.costUsd === undefined ? {} : { cost: options.costUsd }),
      },
    },
  }
}

/** A vector of `dimensions` numbers, different for each `seed`. */
export const fakeVector = (seed = 1, dimensions = 1024): number[] =>
  Array.from({ length: dimensions }, (_, i) => Math.sin(seed * (i + 1)))

/**
 * A unit vector `angleDegrees` away from the axis `axis`, turned towards the
 * next axis, so tests can place vectors at known distances: the cosine
 * distance to `fakeDirection(axis)` grows with the angle. Give each test its
 * own axis, and its vectors stay far from every other test's.
 */
export function fakeDirection(
  axis: number,
  angleDegrees = 0,
  dimensions = 1024,
): number[] {
  const vector = Array.from({ length: dimensions }, () => 0)
  const radians = (angleDegrees * Math.PI) / 180
  vector[axis % dimensions] = Math.cos(radians)
  vector[(axis + 1) % dimensions] = Math.sin(radians)
  return vector
}
