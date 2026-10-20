import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  allocateEnvironment,
  assertTestResources,
  availablePort,
  childEnvironment,
  prepareEnvironment,
  removeEnvironment,
} from '../e2e/support/environment.ts'
import {
  prepareFixtures,
  prepareDemoFixtures,
} from '../e2e/support/fixtures.ts'
import {
  isRunning,
  pollUntil,
  startNode,
  stopProcess,
  stopWorker,
  type RunningProcess,
} from '../e2e/support/processes.ts'

const cwd = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const args = process.argv.slice(2).filter((argument) => argument !== '--')
const diagnostics = args
  .find((argument) => argument.startsWith('--probe='))
  ?.slice(8)
const demo = args.includes('--demo')
const browserArgs = args.filter(
  (argument) => !argument.startsWith('--probe=') && argument !== '--demo',
)
if (diagnostics && !['setup', 'interrupt', 'assertion'].includes(diagnostics))
  throw new Error('Unknown harness probe')
const resources = allocateEnvironment()
assertTestResources(resources)
const stateDir = join(cwd, '.e2e')
await mkdir(stateDir, { recursive: true })
const lockPath = join(stateDir, 'launcher.lock')
let lock
try {
  lock = await open(lockPath, 'wx')
} catch {
  throw new Error(
    'Another E2E launcher holds apps/web/.e2e/launcher.lock. Do not run two launchers in one checkout.',
  )
}
await lock.writeFile(JSON.stringify({ pid: process.pid }))

const runDir = join(stateDir, 'runs', resources.id)
await mkdir(runDir, { recursive: true })
const statePath = join(runDir, 'lifecycle.json')
const envState = {
  id: resources.id,
  database: resources.database.name,
  bucket: resources.storage.STORAGE_BUCKET,
  status: 'preparing',
  cleaned: false,
  childPids: [] as number[],
}
const state = async (status: string) => {
  envState.status = status
  await writeFile(statePath, JSON.stringify(envState, null, 2))
  process.send?.({ event: status, id: resources.id, statePath })
}
let interrupted = false
const interrupt = () => {
  interrupted = true
}
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)
process.on('message', (message: unknown) => {
  if (
    typeof message === 'object' &&
    message &&
    'command' in message &&
    message.command === 'stop'
  )
    interrupt()
})
const checkInterrupt = () => {
  if (interrupted) throw new Error('E2E run interrupted')
}
let web: RunningProcess | undefined
let worker: RunningProcess | undefined
let browsers: RunningProcess | undefined
let resourcesStarted = false
let result = 1
try {
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  const env = childEnvironment(resources, origin)
  env.E2E_RESULTS_DIR = join(runDir, 'test-results')
  env.E2E_REPORT_DIR = join(runDir, 'playwright-report')
  if (diagnostics === 'assertion') env.E2E_PROBE = 'assertion'
  console.info(
    `E2E ${resources.id}: ${origin}, ${resources.database.name}, ${resources.storage.STORAGE_BUCKET}`,
  )
  await writeFile(join(stateDir, 'latest-report.txt'), env.E2E_REPORT_DIR)
  await state('preparing')
  resourcesStarted = true
  await prepareEnvironment(resources, origin)
  checkInterrupt()
  if (diagnostics === 'setup') throw new Error('Expected harness setup failure')
  env.E2E_FIXTURES = JSON.stringify(await prepareFixtures(env))
  if (demo) await prepareDemoFixtures(env, resources.database.workerUrl)
  checkInterrupt()
  worker = startNode(
    join(cwd, 'e2e/support/worker.ts'),
    [],
    {
      ...env,
      DATABASE_URL: resources.database.workerUrl,
    },
    cwd,
  )
  envState.childPids.push(worker.child.pid!)
  let workerReady = false
  worker.child.on('message', (message: unknown) => {
    if (
      typeof message === 'object' &&
      message &&
      'event' in message &&
      message.event === 'ready'
    )
      workerReady = true
  })
  await pollUntil(
    'worker readiness',
    async () => {
      checkInterrupt()
      if (!isRunning(worker!.child))
        throw new Error(`Worker startup failed:\n${worker!.output()}`)
      return workerReady
    },
    Boolean,
  )
  web = startNode(
    require.resolve('next/dist/bin/next'),
    ['dev', '--hostname', '127.0.0.1', '--port', String(port)],
    env,
    cwd,
  )
  envState.childPids.push(web.child.pid!)
  await pollUntil(
    'web database health',
    async () => {
      checkInterrupt()
      if (!isRunning(web!.child))
        throw new Error(`Web startup failed:\n${web!.output()}`)
      try {
        const response = await fetch(`${origin}/api/health`, {
          signal: AbortSignal.timeout(3000),
        })
        return response.status === 200
      } catch {
        return false
      }
    },
    Boolean,
    120_000,
  )
  await state('ready')
  if (diagnostics === 'interrupt') {
    while (true) {
      if (interrupted) break
      await delay(100)
    }
    checkInterrupt()
  }
  browsers = startNode(
    demo
      ? join(cwd, 'scripts/demo-flow.ts')
      : require.resolve('@playwright/test/cli'),
    demo ? ['--base-url', origin] : ['test', ...browserArgs],
    env,
    cwd,
  )
  envState.childPids.push(browsers.child.pid!)
  browsers.child.stdout?.pipe(process.stdout)
  browsers.child.stderr?.pipe(process.stderr)
  await state('testing')
  const finished = await Promise.race([
    browsers.exited,
    (async () => {
      while (true) {
        if (interrupted || !isRunning(browsers.child)) break
        await delay(100)
      }
      return interrupted ? 130 : browsers.exited
    })(),
  ])
  result = finished
  if (demo) {
    await writeFile(join(runDir, 'demo.txt'), browsers.output())
    if (
      /skipped: not built yet|not run: an earlier step failed/.test(
        browsers.output(),
      )
    )
      result = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'E2E setup failed')
  result = interrupted ? 130 : 1
} finally {
  const cleanupErrors: unknown[] = []
  for (const [running, stop] of [
    [browsers, stopProcess],
    [web, stopProcess],
    [worker, stopWorker],
  ] as const) {
    if (running)
      try {
        await stop(running)
      } catch (error) {
        cleanupErrors.push(error)
      }
  }
  if (resourcesStarted)
    try {
      await removeEnvironment(resources)
    } catch (error) {
      cleanupErrors.push(error)
    }
  envState.cleaned = cleanupErrors.length === 0
  await state(envState.cleaned ? 'cleaned' : 'cleanup-failed')
  await lock.close()
  await rm(lockPath)
  if (cleanupErrors.length) {
    console.error(
      'E2E cleanup failed; inspect the owned resources in',
      statePath,
    )
    result = 1
  }
  if (process.connected) process.disconnect()
}
process.exitCode = result
