import {
  loadAiConfig,
  loadNotificationConfig,
  loadStorageConfig,
} from '@ecokart/core'
import { loadVideoTools } from '@ecokart/core/worker'
import { startWorker } from '../../../worker/src/worker.ts'

if (process.env.ECOKART_E2E !== '1')
  throw new Error('This worker wrapper is for E2E only')
const worker = await startWorker({
  databaseUrl: process.env.DATABASE_URL!,
  notifications: loadNotificationConfig(),
  storage: loadStorageConfig(),
  videoTools: loadVideoTools(),
  ai: loadAiConfig(),
})
process.send?.({ event: 'ready' })
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  try {
    await worker.stop()
  } catch {
    process.exitCode = 1
  }
  process.disconnect?.()
}
process.on('message', (message: unknown) => {
  if (
    typeof message === 'object' &&
    message &&
    'command' in message &&
    message.command === 'stop'
  )
    void stop()
})
process.once('disconnect', () => void stop())
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void stop())
