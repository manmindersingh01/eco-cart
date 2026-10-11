import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { testDatabase, testStorageEnv, worktreeTag } from './urls.ts'

/** A folder with a .git folder (main checkout) or .git file (linked worktree). */
function checkout(name: string, kind: 'main' | 'worktree'): string {
  const root = join(mkdtempSync(join(tmpdir(), 'ecokart-')), name)
  mkdirSync(join(root, 'packages', 'core'), { recursive: true })
  if (kind === 'main') mkdirSync(join(root, '.git'))
  else writeFileSync(join(root, '.git'), 'gitdir: /somewhere/else\n')
  return root
}

describe('worktreeTag', () => {
  test('is empty in the main checkout', () => {
    const root = checkout('eco-cart', 'main')
    expect(worktreeTag(join(root, 'packages', 'core'))).toBe('')
  })

  test('comes from the folder name of a linked worktree', () => {
    const root = checkout('Step-7 Moderation', 'worktree')
    expect(worktreeTag(join(root, 'packages', 'core'))).toBe(
      'step_7_moderation',
    )
  })

  test('keeps long names short and apart', () => {
    const first = worktreeTag(
      checkout('backend-step-12-checkout-and-payments', 'worktree'),
    )
    const second = worktreeTag(
      checkout('backend-step-12-checkout-and-refunds', 'worktree'),
    )
    expect(first).toMatch(/^backend_step_12_c_[0-9a-f]{6}$/)
    expect(second).toMatch(/^backend_step_12_c_[0-9a-f]{6}$/)
    expect(first).not.toBe(second)
  })
})

describe('test names', () => {
  test('are unchanged in the main checkout', () => {
    expect(testDatabase('core', 'postgres://localhost/postgres', '').name).toBe(
      'ecokart_test_core',
    )
    expect(testStorageEnv('core', 'http://localhost:8333', '')).toMatchObject({
      STORAGE_BUCKET: 'ecokart-test-core',
      STORAGE_PUBLIC_URL: 'http://localhost:8333/ecokart-test-core',
    })
  })

  test('carry the worktree tag in a linked worktree', () => {
    const database = testDatabase(
      'web',
      'postgres://ecokart:ecokart@localhost:15434/postgres',
      'step_7',
    )
    expect(database.name).toBe('ecokart_test_web_step_7')
    expect(database.webUrl).toBe(
      'postgres://ecokart_web:ecokart_web@localhost:15434/ecokart_test_web_step_7',
    )
    expect(
      testStorageEnv('web', 'http://localhost:8333', 'step_7'),
    ).toMatchObject({ STORAGE_BUCKET: 'ecokart-test-web-step-7' })
  })
})
