import { z } from 'zod'
import {
  AiProviderError,
  NO_USAGE,
  usageSchema,
  type AiClient,
  type AiRequestOptions,
  type ModelReply,
} from './client.ts'

/*
 * Embedder (design doc 3.2): texts and photos in, one vector each out, from
 * one multimodal model, so product text, product photos, and buyers'
 * queries share one index (design doc 6.8).
 */

/** The size of `product_embeddings.embedding`; a test keeps the two equal. */
export const EMBEDDING_DIMENSIONS = 1024

/** A text, or the address of a photo the provider can fetch. */
export type EmbedInput = { text: string } | { imageUrl: string }

/** Catalogue items are documents; buyers' searches are queries. */
export type EmbedInputType = 'search_document' | 'search_query'

export interface EmbedOptions extends AiRequestOptions {
  inputType: EmbedInputType
}

export interface Embedder {
  readonly provider: string
  readonly model: string
  readonly dimensions: number
  /** One vector per input, in the same order. */
  embed(
    inputs: EmbedInput[],
    options: EmbedOptions,
  ): Promise<ModelReply<number[][]>>
}

const embeddingsResponse = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number().int().nonnegative().optional(),
    }),
  ),
  usage: usageSchema.optional(),
})

type MultimodalPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type MultimodalInput = { content: MultimodalPart[] }

// Plain strings are what every OpenAI-compatible provider accepts, so a
// batch of texts stays portable; only a batch with photos needs OpenRouter's
// multimodal form.
function requestInput(inputs: EmbedInput[]): string[] | MultimodalInput[] {
  if (inputs.every((input) => 'text' in input)) {
    return inputs.map((input) => input.text)
  }
  return inputs.map((input): MultimodalInput => ({
    content: [
      'text' in input
        ? { type: 'text', text: input.text }
        : { type: 'image_url', image_url: { url: input.imageUrl } },
    ],
  }))
}

export function createEmbedder(
  client: AiClient,
  model: string,
  dimensions: number,
): Embedder {
  return {
    provider: client.provider,
    model,
    dimensions,

    async embed(inputs, options) {
      if (inputs.length === 0) return { value: [], usage: NO_USAGE }
      if (inputs.some((input) => 'text' in input && input.text.trim() === '')) {
        throw new Error('An empty text cannot be embedded')
      }
      const { inputType, ...requestOptions } = options
      const response = await client.post(
        '/embeddings',
        {
          model,
          input: requestInput(inputs),
          dimensions,
          input_type: inputType,
          encoding_format: 'float',
        },
        embeddingsResponse,
        requestOptions,
      )
      const usage = response.usage ?? NO_USAGE

      if (response.data.length !== inputs.length) {
        throw new AiProviderError(
          `The AI provider sent ${response.data.length} vectors for ${inputs.length} inputs`,
          { usage },
        )
      }
      // Providers may list the vectors in any order; `index` says whose
      // each one is.
      const vectors: number[][] = Array.from({ length: inputs.length })
      response.data.forEach((item, position) => {
        vectors[item.index ?? position] = item.embedding
      })
      for (const vector of vectors) {
        if (vector === undefined || vectors.length !== inputs.length) {
          throw new AiProviderError(
            'The AI provider’s vectors do not match the inputs one to one',
            { usage },
          )
        }
        if (vector.length !== dimensions) {
          throw new AiProviderError(
            `The AI provider sent vectors of ${vector.length} numbers; ${dimensions} were expected`,
            { usage },
          )
        }
      }
      return { value: vectors, usage }
    },
  }
}
