import {
  askAssistant,
  consumeAssistantAllowance,
  withContext,
} from '@ecokart/core'
import { getAiModels } from '@/lib/ai'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/**
 * Asks the shopping assistant, for anyone:
 * `{ "question": "...", "history": [{ "from": "shopper" | "assistant", "text": "..." }], "productIds": ["..."] }`.
 * The answer names products as cards, never as text to show as HTML. Never
 * cached; each question counts against the visitor's address.
 */
export const POST = handleErrors(async (request: Request) => {
  const address = clientIp(request)
  const input = await readJsonBody(request)
  const db = getDatabase()
  // Its own transaction, so the count's row lock is released at once.
  await withContext(db, { role: 'anonymous' }, (tx) =>
    consumeAssistantAllowance(tx, address),
  )
  const answer = await askAssistant(
    { db, photos: getStorage(), ai: getAiModels() },
    input,
  )
  return Response.json(answer)
})
