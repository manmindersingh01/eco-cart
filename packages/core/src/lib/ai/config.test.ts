import { describe, expect, test } from 'vitest'
import { loadAiConfig } from './config.ts'

const openRouter = {
  AI_ENABLED: 'true',
  AI_BASE_URL: 'https://openrouter.ai/api/v1',
  AI_API_KEY: `sk-or-v1-${'a'.repeat(64)}`,
  AI_CHAT_MODEL: 'deepseek/deepseek-v4.1-flash',
  AI_VISION_MODEL: 'deepseek/deepseek-v4.1-flash',
  AI_EMBED_MODEL: 'voyageai/voyage-multimodal-3.5',
  AI_EMBED_DIMENSIONS: '1024',
}

const production = (values: Record<string, string>) => ({
  NODE_ENV: 'production',
  ...values,
})

describe('loadAiConfig', () => {
  test('gives nothing when AI is switched off, without reading the rest', () => {
    expect(loadAiConfig({ AI_ENABLED: 'false', AI_BASE_URL: 'nonsense' })).toBe(
      null,
    )
  })

  test('needs AI switched on or off explicitly', () => {
    expect(() => loadAiConfig({})).toThrow('AI_ENABLED must be true or false')
    expect(() => loadAiConfig({ AI_ENABLED: 'yes' })).toThrow(
      'AI_ENABLED must be true or false',
    )
  })

  test('reads OpenRouter for chat, vision, and embeddings', () => {
    const chat = {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: openRouter.AI_API_KEY,
    }
    expect(loadAiConfig(production(openRouter))).toEqual({
      chat,
      embed: chat,
      chatModel: 'deepseek/deepseek-v4.1-flash',
      visionModel: 'deepseek/deepseek-v4.1-flash',
      embedModel: 'voyageai/voyage-multimodal-3.5',
      embedDimensions: 1024,
    })
  })

  test('sends embeddings elsewhere only with both of their own settings', () => {
    const config = loadAiConfig(
      production({
        ...openRouter,
        AI_EMBED_BASE_URL: 'https://api.voyageai.com/v1',
        AI_EMBED_API_KEY: 'pa-'.padEnd(40, 'b'),
      }),
    )
    expect(config?.embed).toEqual({
      baseUrl: 'https://api.voyageai.com/v1',
      apiKey: 'pa-'.padEnd(40, 'b'),
    })
    expect(() =>
      loadAiConfig({
        ...openRouter,
        AI_EMBED_BASE_URL: 'https://api.voyageai.com/v1',
      }),
    ).toThrow(
      'AI_EMBED_API_KEY must be set together with AI_EMBED_BASE_URL, or neither',
    )
  })

  test('names every missing setting, and treats an empty line as missing', () => {
    expect(() =>
      loadAiConfig({
        AI_ENABLED: 'true',
        AI_API_KEY: '',
        AI_EMBED_BASE_URL: '',
      }),
    ).toThrow(
      [
        'Invalid environment:',
        '- AI_BASE_URL is required when AI_ENABLED is true',
        '- AI_API_KEY is required when AI_ENABLED is true',
        '- AI_CHAT_MODEL is required when AI_ENABLED is true',
        '- AI_VISION_MODEL is required when AI_ENABLED is true',
        '- AI_EMBED_MODEL is required when AI_ENABLED is true',
        '- AI_EMBED_DIMENSIONS must be 1024, the size of product_embeddings.embedding',
      ].join('\n'),
    )
  })

  test('refuses another vector size', () => {
    expect(() =>
      loadAiConfig({ ...openRouter, AI_EMBED_DIMENSIONS: '512' }),
    ).toThrow(
      'AI_EMBED_DIMENSIONS must be 1024, the size of product_embeddings.embedding',
    )
  })

  test('refuses an address that is not one', () => {
    expect(() =>
      loadAiConfig({ ...openRouter, AI_BASE_URL: 'openrouter.ai' }),
    ).toThrow(
      'AI_BASE_URL must be an address like https://openrouter.ai/api/v1',
    )
  })

  test('allows the local test server and its key outside production only', () => {
    const local = {
      ...openRouter,
      AI_BASE_URL: 'http://127.0.0.1:4010/api/v1',
      AI_API_KEY: 'development-only-fake-ai-key',
    }
    expect(loadAiConfig({ NODE_ENV: 'development', ...local })?.chat).toEqual({
      baseUrl: 'http://127.0.0.1:4010/api/v1',
      apiKey: 'development-only-fake-ai-key',
    })
    const error = (() => {
      try {
        loadAiConfig(production(local))
        return ''
      } catch (caught) {
        return caught instanceof Error ? caught.message : String(caught)
      }
    })()
    expect(error).toContain(
      'AI_BASE_URL must use https in production, so the key is never sent in the clear',
    )
    expect(error).toContain(
      'AI_BASE_URL is a local address, such as the test server; production needs a real provider',
    )
    expect(error).toContain(
      'AI_API_KEY is the development example value; set a real secret',
    )
    // The message names the problem, never the value.
    expect(error).not.toContain('development-only-fake-ai-key')
  })
})
