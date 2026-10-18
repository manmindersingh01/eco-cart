import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { productEmbeddings } from '../../db/schema/index.ts'
import { rejectionOf } from '../../testing/errors.ts'
import {
  FAKE_AI_KEY,
  fakeChatReply,
  fakeEmbeddingsReply,
  fakeVector,
  startFakeAiServer,
  type FakeAiServer,
} from '../../testing/ai.ts'
import { createTextModel, createVisionModel, type JsonPrompt } from './chat.ts'
import {
  AiProviderError,
  AiReplyError,
  createAiClient,
  providerName,
} from './client.ts'
import { createEmbedder, EMBEDDING_DIMENSIONS } from './embed.ts'
import { createAiModels } from './index.ts'

let fake: FakeAiServer

beforeAll(async () => {
  fake = await startFakeAiServer()
})

afterAll(async () => {
  await fake.close()
})

beforeEach(() => {
  fake.requests.length = 0
})

const client = () => createAiClient({ baseUrl: fake.url, apiKey: FAKE_AI_KEY })
const text = () => createTextModel(client(), 'deepseek/deepseek-v4.1-flash')

const draft = z.strictObject({
  title: z.string().min(3),
  highlights: z.array(z.string()).max(3),
})

const prompt: JsonPrompt = {
  system: 'You write product titles for an Indian eco-friendly marketplace.',
  user: 'Bamboo toothbrush, soft bristles, pack of 4',
  example: { title: 'Bamboo Toothbrush, Pack of 4', highlights: ['Soft'] },
}

const good = { title: 'Bamboo Toothbrush, Soft, Pack of 4', highlights: [] }

/** The chat request's messages, as the fake server received them. */
const messagesOf = (index: number) =>
  z
    .object({
      messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
    })
    .parse(fake.requests[index]!.body).messages

const embedder = () =>
  createEmbedder(client(), 'voyageai/voyage-multimodal-3.5', 1024)

describe('TextModel.json', () => {
  test('asks for JSON mode with an example of the shape and returns the checked answer', async () => {
    fake.queue(
      fakeChatReply(good, {
        inputTokens: 210,
        outputTokens: 30,
        costUsd: 0.000_05,
      }),
    )
    const reply = await text().json(prompt, draft)

    expect(reply).toEqual({
      value: good,
      usage: { inputTokens: 210, outputTokens: 30, costUsd: 0.000_05 },
    })
    expect(fake.requests).toHaveLength(1)
    const [request] = fake.requests
    expect(request!.path).toBe('/chat/completions')
    expect(request!.authorization).toBe(`Bearer ${FAKE_AI_KEY}`)
    expect(request!.body).toMatchObject({
      model: 'deepseek/deepseek-v4.1-flash',
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    })
    const [system, user] = messagesOf(0)
    expect(system!.role).toBe('system')
    expect(system!.content).toContain(prompt.system)
    expect(system!.content).toContain('JSON')
    expect(system!.content).toContain('"title": "Bamboo Toothbrush, Pack of 4"')
    expect(user).toEqual({ role: 'user', content: prompt.user })
  })

  test('passes on the caller’s answer length and temperature', async () => {
    fake.queue(fakeChatReply(good))
    await text().json(prompt, draft, { maxOutputTokens: 300, temperature: 0 })
    expect(fake.requests[0]!.body).toMatchObject({
      max_tokens: 300,
      temperature: 0,
    })
  })

  test('asks once more with the reason when the answer does not fit, and adds up both tries', async () => {
    fake.queue(
      fakeChatReply(
        { title: 'Br', highlights: [] },
        { inputTokens: 200, outputTokens: 20, costUsd: 0.000_04 },
      ),
      fakeChatReply(good, {
        inputTokens: 260,
        outputTokens: 25,
        costUsd: 0.000_06,
      }),
    )
    const reply = await text().json(prompt, draft)

    expect(reply.value).toEqual(good)
    expect(reply.usage.inputTokens).toBe(460)
    expect(reply.usage.outputTokens).toBe(45)
    expect(reply.usage.costUsd).toBeCloseTo(0.000_1, 10)
    const retry = messagesOf(1)
    expect(retry).toHaveLength(4)
    expect(retry[2]).toEqual({
      role: 'assistant',
      content: '{"title":"Br","highlights":[]}',
    })
    expect(retry[3]!.role).toBe('user')
    expect(retry[3]!.content).toContain(
      'the answer does not fit: title Too small',
    )
  })

  test('asks once more when the answer is not JSON at all', async () => {
    fake.queue(
      fakeChatReply('Here is your title: Bamboo Toothbrush'),
      fakeChatReply(good),
    )
    expect((await text().json(prompt, draft)).value).toEqual(good)
    expect(messagesOf(1)[3]!.content).toContain('the answer is not valid JSON')
  })

  test('reads JSON wrapped in a code block without asking again', async () => {
    fake.queue(fakeChatReply(`\`\`\`json\n${JSON.stringify(good)}\n\`\`\``))
    expect((await text().json(prompt, draft)).value).toEqual(good)
    expect(fake.requests).toHaveLength(1)
  })

  test('treats an answer cut off at the length cap as unusable', async () => {
    fake.queue(
      fakeChatReply('{"title": "Bamboo Tooth', { finishReason: 'length' }),
      fakeChatReply(good),
    )
    expect((await text().json(prompt, draft)).value).toEqual(good)
    expect(messagesOf(1)[3]!.content).toContain('the answer was cut off')
  })

  test('does not send back an empty answer', async () => {
    fake.queue(fakeChatReply(''), fakeChatReply(good))
    await text().json(prompt, draft)
    const retry = messagesOf(1)
    expect(retry.map((message) => message.role)).toEqual([
      'system',
      'user',
      'user',
    ])
    expect(retry[2]!.content).toContain('the answer was empty')
  })

  test('refuses after a second unusable answer, keeping both reasons and the usage', async () => {
    fake.queue(
      fakeChatReply('not json', { inputTokens: 100, outputTokens: 5 }),
      fakeChatReply({ title: 'Bamboo' }, { inputTokens: 110, outputTokens: 7 }),
    )
    const replyError = await rejectionOf(
      text().json(prompt, draft),
      AiReplyError,
    )
    expect(replyError.problems).toEqual([
      'the answer is not valid JSON',
      'the answer does not fit: highlights is required',
    ])
    expect(replyError.usage).toEqual({
      inputTokens: 210,
      outputTokens: 12,
      costUsd: null,
    })
    expect(fake.requests).toHaveLength(2)
  })

  test('keeps the first try’s usage when the second try cannot reach the provider', async () => {
    fake.queue(
      fakeChatReply('not json', { inputTokens: 100, outputTokens: 5 }),
      { status: 502, body: { error: { message: 'Upstream error' } } },
    )
    const error = await rejectionOf(text().json(prompt, draft), AiProviderError)
    expect(error.usage.inputTokens).toBe(100)
    expect(error.status).toBe(502)
  })

  test('reports no cost when the provider reports none', async () => {
    fake.queue(fakeChatReply(good))
    expect((await text().json(prompt, draft)).usage.costUsd).toBeNull()
  })
})

describe('provider failures', () => {
  test('an error status becomes AiProviderError with the provider’s text and never the key', async () => {
    fake.queue({
      status: 429,
      body: { error: { message: 'Rate limit exceeded', code: 429 } },
    })
    const error = await rejectionOf(text().json(prompt, draft), AiProviderError)
    expect(error.message).toBe(
      'The AI provider answered 429: Rate limit exceeded',
    )
    expect(error.status).toBe(429)
    expect(error.message).not.toContain(FAKE_AI_KEY)
  })

  test('a wrong key is refused by the provider', async () => {
    const model = createTextModel(
      createAiClient({ baseUrl: fake.url, apiKey: 'wrong-key' }),
      'deepseek/deepseek-v4.1-flash',
    )
    const error = await rejectionOf(model.json(prompt, draft), AiProviderError)
    expect(error.message).toBe(
      'The AI provider answered 401: No auth credentials found',
    )
    expect(error.message).not.toContain('wrong-key')
  })

  test('an error inside a 200 response is a failure', async () => {
    fake.queue({
      body: { error: { message: 'All providers are unavailable', code: 503 } },
    })
    await expect(text().json(prompt, draft)).rejects.toThrow(
      'The AI provider failed: All providers are unavailable',
    )
  })

  test('a response that is not JSON is a failure', async () => {
    fake.queue({ rawBody: '<html>Bad gateway</html>' })
    await expect(text().json(prompt, draft)).rejects.toThrow(
      'The AI provider sent a response that is not JSON',
    )
  })

  test('a response in another shape is a failure', async () => {
    fake.queue({ body: { choices: [] } })
    await expect(text().json(prompt, draft)).rejects.toThrow(
      'The AI provider sent a response in an unexpected shape: choices must hold at least one answer',
    )
  })

  test('gives up after the time limit', async () => {
    fake.queue({ ...fakeChatReply(good), delayMs: 1000 })
    await expect(
      text().json(prompt, draft, { timeoutMs: 200 }),
    ).rejects.toThrow('The AI provider did not answer within 0.2 seconds')
  })

  test('an address nobody answers on is a failure', async () => {
    const unreachable = await startFakeAiServer()
    await unreachable.close()
    const model = createTextModel(
      createAiClient({ baseUrl: unreachable.url, apiKey: FAKE_AI_KEY }),
      'deepseek/deepseek-v4.1-flash',
    )
    const error = await rejectionOf(model.json(prompt, draft), AiProviderError)
    expect(error.message).toMatch(/^The AI provider could not be reached: /)
  })
})

describe('VisionModel.describe', () => {
  test('sends the question and each photo as image parts', async () => {
    fake.queue(fakeChatReply(good))
    const vision = createVisionModel(client(), 'deepseek/deepseek-v4.1-flash')
    const photos = [
      'https://images.ecokart.example/images/a/card.webp',
      'https://images.ecokart.example/images/b/card.webp',
    ]
    expect((await vision.describe(photos, prompt, draft)).value).toEqual(good)
    expect(messagesOf(0)[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: prompt.user },
        { type: 'image_url', image_url: { url: photos[0] } },
        { type: 'image_url', image_url: { url: photos[1] } },
      ],
    })
  })

  test('needs at least one photo', async () => {
    const vision = createVisionModel(client(), 'deepseek/deepseek-v4.1-flash')
    await expect(vision.describe([], prompt, draft)).rejects.toThrow(
      'describe() needs at least one image',
    )
    expect(fake.requests).toHaveLength(0)
  })
})

describe('Embedder.embed', () => {
  test('sends texts as plain strings with the input type and size', async () => {
    fake.queue(
      fakeEmbeddingsReply([fakeVector(1), fakeVector(2)], {
        inputTokens: 14,
        costUsd: 0.000_001_68,
      }),
    )
    const reply = await embedder().embed(
      [{ text: 'steel bottle' }, { text: 'bamboo toothbrush' }],
      { inputType: 'search_query' },
    )
    expect(reply.value).toEqual([fakeVector(1), fakeVector(2)])
    expect(reply.usage).toEqual({
      inputTokens: 14,
      outputTokens: 0,
      costUsd: 0.000_001_68,
    })
    expect(fake.requests[0]!.path).toBe('/embeddings')
    expect(fake.requests[0]!.body).toEqual({
      model: 'voyageai/voyage-multimodal-3.5',
      input: ['steel bottle', 'bamboo toothbrush'],
      dimensions: 1024,
      input_type: 'search_query',
      encoding_format: 'float',
    })
  })

  test('sends a batch with photos in the multimodal form', async () => {
    fake.queue(fakeEmbeddingsReply([fakeVector(1), fakeVector(2)]))
    await embedder().embed(
      [
        { text: 'Bamboo Toothbrush, Pack of 4' },
        { imageUrl: 'https://images.ecokart.example/images/a/card.webp' },
      ],
      { inputType: 'search_document' },
    )
    expect(fake.requests[0]!.body).toMatchObject({
      input_type: 'search_document',
      input: [
        { content: [{ type: 'text', text: 'Bamboo Toothbrush, Pack of 4' }] },
        {
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'https://images.ecokart.example/images/a/card.webp',
              },
            },
          ],
        },
      ],
    })
  })

  test('puts vectors back in input order', async () => {
    fake.queue({
      body: {
        data: [
          { object: 'embedding', embedding: fakeVector(2), index: 1 },
          { object: 'embedding', embedding: fakeVector(1), index: 0 },
        ],
      },
    })
    const { value } = await embedder().embed([{ text: 'a' }, { text: 'b' }], {
      inputType: 'search_document',
    })
    expect(value).toEqual([fakeVector(1), fakeVector(2)])
  })

  test('refuses vectors of another size', async () => {
    fake.queue(fakeEmbeddingsReply([fakeVector(1, 512)]))
    await expect(
      embedder().embed([{ text: 'a' }], { inputType: 'search_query' }),
    ).rejects.toThrow(
      'The AI provider sent vectors of 512 numbers; 1024 were expected',
    )
  })

  test('refuses a different number of vectors than inputs', async () => {
    fake.queue(fakeEmbeddingsReply([fakeVector(1)]))
    await expect(
      embedder().embed([{ text: 'a' }, { text: 'b' }], {
        inputType: 'search_query',
      }),
    ).rejects.toThrow('The AI provider sent 1 vectors for 2 inputs')
  })

  test('calls nobody for an empty list, and refuses an empty text', async () => {
    expect(
      await embedder().embed([], { inputType: 'search_query' }),
    ).toMatchObject({ value: [] })
    await expect(
      embedder().embed([{ text: '  ' }], { inputType: 'search_query' }),
    ).rejects.toThrow('An empty text cannot be embedded')
    expect(fake.requests).toHaveLength(0)
  })

  test('has the size of the product_embeddings column', () => {
    const column = getTableConfig(productEmbeddings).columns.find(
      (candidate) => candidate.name === 'embedding',
    )
    expect(column).toMatchObject({ dimensions: EMBEDDING_DIMENSIONS })
  })
})

describe('createAiModels', () => {
  test('sends embeddings to their own endpoint when one is set', async () => {
    const other = await startFakeAiServer()
    try {
      other.queue(fakeEmbeddingsReply([fakeVector(1)]))
      fake.queue(fakeChatReply(good))
      const models = createAiModels(
        fake.settings({ embed: { baseUrl: other.url, apiKey: FAKE_AI_KEY } }),
      )
      await models.embed.embed([{ text: 'a' }], { inputType: 'search_query' })
      await models.text.json(prompt, draft)
      expect(other.requests.map((request) => request.path)).toEqual([
        '/embeddings',
      ])
      expect(fake.requests.map((request) => request.path)).toEqual([
        '/chat/completions',
      ])
      expect(models.text.provider).toBe('local')
    } finally {
      await other.close()
    }
  })
})

describe('providerName', () => {
  test('names the provider from its address', () => {
    expect(providerName('https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(providerName('https://api.deepseek.com')).toBe('deepseek')
    expect(providerName('http://127.0.0.1:4010/api/v1')).toBe('local')
    expect(providerName('http://localhost:4010')).toBe('local')
    expect(providerName('https://api.together.xyz/v1')).toBe('api.together.xyz')
  })
})
