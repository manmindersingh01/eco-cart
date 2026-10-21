import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export async function pollUntil<T>(
  description: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await delay(300)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

export function startNode(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    detached: process.platform !== 'win32',
  })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-24_000)
    })
  }
  const exited = new Promise<number>((resolve) => {
    child.once('error', () => resolve(1))
    child.once('exit', (code) => resolve(code ?? 1))
  })
  return { child, exited, output: () => output }
}

export type RunningProcess = ReturnType<typeof startNode>

export async function stopProcess(running: RunningProcess): Promise<void> {
  const { child } = running
  if (!child.pid) return
  if (child.connected) child.send({ command: 'stop' })
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      // The PID is from this launcher's child, never a port lookup or name match.
      await new Promise<void>((resolve, reject) => {
        const killer = spawn(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
        )
        killer.once('error', reject)
        killer.once('exit', () => resolve())
      })
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ESRCH'
        ))
          throw error
      }
    }
  }
  const stopped = await Promise.race([
    running.exited.then(() => true),
    delay(10_000, false, { ref: false }),
  ])
  if (!stopped) {
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ESRCH'
        ))
          throw error
      }
    }
    throw new Error('A test child process did not stop in time')
  }
}

export async function stopWorker(running: RunningProcess): Promise<void> {
  if (running.child.connected) running.child.send({ command: 'stop' })
  const stopped = await Promise.race([
    running.exited.then(() => true),
    delay(35_000, false, { ref: false }),
  ])
  if (!stopped) await stopProcess(running)
}

export const isRunning = (child: ChildProcess) =>
  child.exitCode === null && child.signalCode === null
