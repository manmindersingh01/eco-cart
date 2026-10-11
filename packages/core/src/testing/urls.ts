// Kept free of heavy imports, because every package's vitest.config.ts loads
// it to fill in the test environment.

import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const MAX_WORKTREE_TAG_LENGTH = 24

/**
 * '' in the repository's main checkout (and in CI), or a short tag made from
 * the folder name of a linked git worktree. Test databases and buckets carry
 * the tag, so two checkouts can run their tests at the same time: without it,
 * each run drops the database the other one is testing against.
 */
export function worktreeTag(start: string = process.cwd()): string {
  for (let folder = start; ; folder = dirname(folder)) {
    const git = join(folder, '.git')
    if (existsSync(git)) {
      // The main checkout has a .git folder; a linked worktree has a .git
      // file pointing back at it.
      return statSync(git).isFile() ? tagFor(basename(folder)) : ''
    }
    if (dirname(folder) === folder) return ''
  }
}

/** Lower-case letters, digits, and single underscores, short enough for a bucket name. */
function tagFor(folderName: string): string {
  const tag = folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  if (tag.length <= MAX_WORKTREE_TAG_LENGTH) return tag
  // A hash of the whole name keeps two long names with the same start apart.
  const hash = createHash('sha256').update(folderName).digest('hex').slice(0, 6)
  return `${tag.slice(0, MAX_WORKTREE_TAG_LENGTH - 7).replace(/_$/, '')}_${hash}`
}

const withTag = (name: string, separator: string, tag: string): string =>
  tag === '' ? name : `${name}${separator}${tag.replaceAll('_', separator)}`

const DEFAULT_SERVER_URL = 'postgres://ecokart:ecokart@localhost:15434/postgres'

// The same values as the .env.example files, because role passwords are
// shared by every database on the server.
export const TEST_WEB_PASSWORD = 'ecokart_web'
export const TEST_WORKER_PASSWORD = 'ecokart_worker'

export interface TestDatabase {
  name: string
  /** The server's maintenance database, used to drop and create `name`. */
  serverUrl: string
  /** The owner, for migrations and for test fixtures that skip RLS. */
  migrationUrl: string
  /** The web app's user, subject to row-level security. */
  webUrl: string
  /** The worker's user. */
  workerUrl: string
}

/**
 * Each package tests against its own database, ecokart_test_<suffix>, so test
 * runs never touch the development database or each other. In a linked git
 * worktree the name ends with the worktree's tag (`worktreeTag`). The server
 * comes from TEST_DATABASE_SERVER_URL (CI) or the local compose.yaml database.
 */
export function testDatabase(
  suffix: string,
  serverUrl: string = process.env.TEST_DATABASE_SERVER_URL ??
    DEFAULT_SERVER_URL,
  tag: string = worktreeTag(),
): TestDatabase {
  const name = withTag(`ecokart_test_${suffix}`, '_', tag)
  const urlFor = (user?: string, password?: string): string => {
    const url = new URL(serverUrl)
    url.pathname = `/${name}`
    if (user !== undefined && password !== undefined) {
      url.username = user
      url.password = password
    }
    return url.href
  }
  return {
    name,
    serverUrl,
    migrationUrl: urlFor(),
    webUrl: urlFor('ecokart_web', TEST_WEB_PASSWORD),
    workerUrl: urlFor('ecokart_worker', TEST_WORKER_PASSWORD),
  }
}

const DEFAULT_STORAGE_ENDPOINT = 'http://localhost:8333'

/**
 * Storage settings for a package's tests: its own bucket, ecokart-test-<suffix>
 * (with the worktree's tag in a linked git worktree), on the compose.yaml
 * storage service or CI's (TEST_STORAGE_ENDPOINT).
 */
export function testStorageEnv(
  suffix: string,
  endpoint: string = process.env.TEST_STORAGE_ENDPOINT ??
    DEFAULT_STORAGE_ENDPOINT,
  tag: string = worktreeTag(),
): Record<string, string> {
  const bucket = withTag(`ecokart-test-${suffix}`, '-', tag)
  return {
    STORAGE_BUCKET: bucket,
    STORAGE_REGION: 'ap-south-1',
    STORAGE_ENDPOINT: endpoint,
    // The same values as compose.yaml and the CI service.
    STORAGE_ACCESS_KEY_ID: 'ecokart',
    STORAGE_SECRET_ACCESS_KEY: 'development-only-storage-secret',
    STORAGE_PUBLIC_URL: `${endpoint}/${bucket}`,
  }
}
