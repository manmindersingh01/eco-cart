import { createAiModels, loadAiConfig, type AiModels } from '@ecokart/core'

const globalForAi = globalThis as typeof globalThis & {
  ecokartAiModels?: AiModels | null
}

/** The AI models (backend spec step 17), or null when AI_ENABLED is false. */
export function getAiModels(): AiModels | null {
  if (globalForAi.ecokartAiModels === undefined) {
    const settings = loadAiConfig()
    globalForAi.ecokartAiModels = settings ? createAiModels(settings) : null
  }
  return globalForAi.ecokartAiModels
}
