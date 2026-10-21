import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  createObjectStorage,
  createPool,
  loadStorageConfig,
} from '@ecokart/core'
import {
  allocateEnvironment,
  prepareEnvironment,
  removeEnvironment,
} from '../e2e/support/environment.ts'
import { startNode, stopProcess } from '../e2e/support/processes.ts'
import { z } from 'zod'

const cwd = dirname(dirname(fileURLToPath(import.meta.url)))
const sentinel = allocateEnvironment()
await prepareEnvironment(sentinel, 'http://127.0.0.1:3211')
const pool = createPool(sentinel.database.migrationUrl, 'e2e-sentinel')
const storage = createObjectStorage(
  loadStorageConfig({ NODE_ENV: 'test', ...sentinel.storage }),
)
const seen = new Set<string>()
try {
  await pool.query('create table e2e_sentinel (value text)')
  await pool.query('insert into e2e_sentinel values ($1)', [sentinel.id])
  await storage.write('sentinel.txt', Buffer.from(sentinel.id), {
    contentType: 'text/plain',
  })
  for (const probe of ['setup', 'interrupt', 'assertion']) {
    const running = startNode(
      join(cwd, 'scripts/test-e2e.ts'),
      [`--probe=${probe}`, '--project=chromium-desktop'],
      process.env,
      cwd,
    )
    let statePath = ''
    running.child.on('message', (message: unknown) => {
      if (typeof message !== 'object' || !message || !('statePath' in message))
        return
      statePath = String(message.statePath)
      if (
        probe === 'interrupt' &&
        'event' in message &&
        message.event === 'ready'
      ) {
        running.child.send({ command: 'stop' })
      }
    })
    const timeout = new AbortController()
    const expired = delay(240_000, -1, { signal: timeout.signal }).catch(
      () => -2,
    )
    let code: number
    try {
      code = await Promise.race([running.exited, expired])
      assert.notEqual(code, -1, `${probe} timed out`)
    } finally {
      timeout.abort()
      await stopProcess(running)
    }
    assert.notEqual(code, 0, `${probe} should fail deliberately`)
    assert.ok(statePath, `Missing ${probe} lifecycle evidence`)
    const state = z
      .object({
        id: z.string(),
        cleaned: z.boolean(),
        database: z.string(),
        childPids: z.array(z.number()),
      })
      .parse(JSON.parse(await readFile(statePath, 'utf8')))
    assert.equal(state.cleaned, true, `${probe}: ${running.output()}`)
    assert.equal(seen.has(state.id), false)
    seen.add(state.id)
    const server = createPool(sentinel.database.serverUrl, 'e2e-verification')
    try {
      const result = await server.query(
        'select 1 from pg_database where datname = $1',
        [state.database],
      )
      assert.equal(result.rowCount, 0, 'Probe database was not deleted')
    } finally {
      await server.end()
    }
    for (const pid of state.childPids) {
      assert.throws(
        () => process.kill(pid, 0),
        'Owned child process is still alive',
      )
    }
    assert.equal(
      (await pool.query('select value from e2e_sentinel')).rows[0]?.value,
      sentinel.id,
    )
    assert.equal((await storage.read('sentinel.txt'))?.toString(), sentinel.id)
    if (probe === 'assertion') {
      const artifacts = await readdir(dirname(statePath), { recursive: true })
      for (const suffix of ['trace.zip', '.png', 'index.html', 'junit.xml']) {
        assert.ok(
          artifacts.some((file) => file.endsWith(suffix)),
          `Missing ${suffix}`,
        )
      }
    }
    console.info(
      `PASS P02/P05/P06 ${probe}: unique resources, expected failure, cleanup and sentinel preservation`,
    )
  }
} finally {
  await pool.end()
  await removeEnvironment(sentinel)
}
