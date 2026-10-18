import { createVisionModel, createTextModel } from './chat.ts'
import type { TextModel, VisionModel } from './chat.ts'
import { createAiClient, type AiEndpoint } from './client.ts'
import { createEmbedder, type Embedder } from './embed.ts'

/** Everything needed to reach the models (design doc 3.2). */
export interface AiSettings {
  /** Chat and vision. */
  chat: AiEndpoint
  /** Embeddings; the same as `chat` unless AI_EMBED_BASE_URL is set. */
  embed: AiEndpoint
  chatModel: string
  visionModel: string
  embedModel: string
  embedDimensions: number
}

/** The three kinds of model every AI feature uses. */
export interface AiModels {
  text: TextModel
  vision: VisionModel
  embed: Embedder
}

export function createAiModels(
  settings: AiSettings,
  fetchImpl: typeof fetch = fetch,
): AiModels {
  const chat = createAiClient(settings.chat, fetchImpl)
  const embed =
    settings.embed === settings.chat
      ? chat
      : createAiClient(settings.embed, fetchImpl)
  return {
    text: createTextModel(chat, settings.chatModel),
    vision: createVisionModel(chat, settings.visionModel),
    embed: createEmbedder(embed, settings.embedModel, settings.embedDimensions),
  }
}
