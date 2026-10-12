import { z } from 'zod'
import { describeIssues, plainErrors } from '../validation.ts'
import {
  addUsage,
  AiProviderError,
  AiReplyError,
  NO_USAGE,
  usageSchema,
  type AiClient,
  type AiRequestOptions,
  type AiUsage,
  type ModelReply,
} from './client.ts'

/*
 * TextModel and VisionModel (design doc 3.2): text, or text and photos, in;
 * JSON out. Every answer is checked against a zod schema and asked for once
 * more if it does not fit, so callers only ever see a checked value.
 */

export interface JsonPrompt {
  /** Who the model is and what it must do. */
  system: string
  /** The question, or the data to work on. */
  user: string
  /** An example answer, shown to the model as the shape to follow. */
  example: unknown
}

export interface ChatOptions extends AiRequestOptions {
  /** The longest answer allowed, in tokens; it also caps the cost. */
  maxOutputTokens?: number
  temperature?: number
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 2000

export interface TextModel {
  readonly provider: string
  readonly model: string
  json<S extends z.ZodType>(
    prompt: JsonPrompt,
    schema: S,
    options?: ChatOptions,
  ): Promise<ModelReply<z.output<S>>>
}

export interface VisionModel {
  readonly provider: string
  readonly model: string
  /** `images` are addresses the provider can fetch: card-size photos on CloudFront. */
  describe<S extends z.ZodType>(
    images: string[],
    prompt: JsonPrompt,
    schema: S,
    options?: ChatOptions,
  ): Promise<ModelReply<z.output<S>>>
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type ChatMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | ContentPart[] }

const chatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1, 'must hold at least one answer'),
  usage: usageSchema.optional(),
})

// DeepSeek's JSON mode needs the word "json" in the prompt, and an example
// of the shape makes a fitting answer far more likely (AGENTS.md). Adding it
// here means no caller can forget either.
const systemMessage = (prompt: JsonPrompt): string =>
  `${prompt.system.trim()}\n\nAnswer with one JSON object and nothing else, shaped like this example:\n${JSON.stringify(prompt.example, null, 2)}`

// Some providers wrap JSON in a Markdown code block even in JSON mode;
// unwrapping it saves a second call for an otherwise good answer.
const CODE_BLOCK = /^```(?:json)?\s*([\s\S]*?)\s*```$/i

type Reading<T> = { ok: true; value: T } | { ok: false; problem: string }

function readAnswer<S extends z.ZodType>(
  content: string,
  finishReason: string | null | undefined,
  schema: S,
): Reading<z.output<S>> {
  if (finishReason === 'length') {
    return {
      ok: false,
      problem: 'the answer was cut off because it was too long',
    }
  }
  const text = content.trim().replace(CODE_BLOCK, '$1').trim()
  if (text === '') return { ok: false, problem: 'the answer was empty' }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, problem: 'the answer is not valid JSON' }
  }
  const result = schema.safeParse(json, { error: plainErrors })
  if (!result.success) {
    return {
      ok: false,
      problem: `the answer does not fit: ${describeIssues(result.error).join('; ')}`,
    }
  }
  return { ok: true, value: result.data }
}

async function askForJson<S extends z.ZodType>(
  client: AiClient,
  model: string,
  prompt: JsonPrompt,
  userContent: string | ContentPart[],
  schema: S,
  options: ChatOptions,
): Promise<ModelReply<z.output<S>>> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemMessage(prompt) },
    { role: 'user', content: userContent },
  ]
  const problems: string[] = []
  let usage: AiUsage = NO_USAGE

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: z.output<typeof chatResponse>
    try {
      response = await client.post(
        '/chat/completions',
        {
          model,
          messages,
          response_format: { type: 'json_object' },
          max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          ...(options.temperature === undefined
            ? {}
            : { temperature: options.temperature }),
        },
        chatResponse,
        options,
      )
    } catch (error) {
      // Keep what the first try used, so the log shows the whole cost.
      if (error instanceof AiProviderError && attempt > 1) {
        throw new AiProviderError(error.message, {
          ...(error.status === undefined ? {} : { status: error.status }),
          usage: addUsage(usage, error.usage),
          cause: error,
        })
      }
      throw error
    }

    usage = addUsage(usage, response.usage ?? NO_USAGE)
    const [choice] = response.choices
    const content = choice!.message.content ?? ''
    const reading = readAnswer(content, choice!.finish_reason, schema)
    if (reading.ok) return { value: reading.value, usage }

    problems.push(reading.problem)
    // Showing the model its own answer and what was wrong with it gives the
    // second try a far better chance than asking the same question again.
    if (content.trim() !== '') {
      messages.push({ role: 'assistant', content })
    }
    messages.push({
      role: 'user',
      content: `That answer cannot be used: ${reading.problem}. Answer again with one JSON object and nothing else, shaped like the example.`,
    })
  }

  throw new AiReplyError(
    `The AI model's answer could not be used twice: ${problems.join('; then ')}`,
    usage,
    problems,
  )
}

export function createTextModel(client: AiClient, model: string): TextModel {
  return {
    provider: client.provider,
    model,
    json: (prompt, schema, options = {}) =>
      askForJson(client, model, prompt, prompt.user, schema, options),
  }
}

export function createVisionModel(
  client: AiClient,
  model: string,
): VisionModel {
  return {
    provider: client.provider,
    model,
    async describe(images, prompt, schema, options = {}) {
      if (images.length === 0) {
        throw new Error('describe() needs at least one image')
      }
      const content: ContentPart[] = [
        { type: 'text', text: prompt.user },
        ...images.map((url): ContentPart => ({
          type: 'image_url',
          image_url: { url },
        })),
      ]
      return askForJson(client, model, prompt, content, schema, options)
    },
  }
}
