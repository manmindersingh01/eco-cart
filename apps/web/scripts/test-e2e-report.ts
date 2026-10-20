import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const report = (
  await readFile(
    fileURLToPath(new URL('../.e2e/latest-report.txt', import.meta.url)),
    'utf8',
  )
).trim()
const child = spawn(
  process.execPath,
  [require.resolve('@playwright/test/cli'), 'show-report', report],
  { stdio: 'inherit' },
)
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
