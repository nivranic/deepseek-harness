/** Checkout receipts observe Git's actual committed and dirty state. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { removeFixtureSafely } from '../test-fixture-cleanup.ts'
import { captureCiSource } from './ci-source.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSafely(root) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ci-source-'))
  roots.push(root)
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'empty-global'), GIT_CONFIG_NOSYSTEM: '1' }
  const git = (args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim()
  git(['init', '--quiet', '--initial-branch=main'])
  git(['config', 'user.name', 'CI Fixture']); git(['config', 'user.email', 'ci@example.test'])
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: Fixture\n')
  git(['add', '.']); git(['commit', '--quiet', '-m', 'source'])
  const context = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'pull_request', DSH_CI_CANDIDATE_SHA: git(['rev-parse', 'HEAD']) }
  return { root, git, context }
}

it('records a clean checkout without author or workspace data', () => {
  const { root, git, context } = fixture()
  const receipt = captureCiSource(root, '.github/workflows/ci.yml', context)
  expect(receipt).toMatchObject({ candidateSha: context.DSH_CI_CANDIDATE_SHA, checkoutSha: context.DSH_CI_CANDIDATE_SHA,
    treeSha: git(['rev-parse', 'HEAD^{tree}']), parents: [], dirty: false, runId: 123, runAttempt: 2 })
  expect(JSON.stringify(receipt)).not.toContain(root)
  expect(JSON.stringify(receipt)).not.toContain('ci@example.test')
})

it('records parent metadata even when Git considers the checkout shallow', () => {
  const { root, git, context } = fixture()
  writeFileSync(join(root, 'next.txt'), 'next\n')
  git(['add', '.']); git(['commit', '--quiet', '-m', 'next'])
  writeFileSync(join(root, '.git/shallow'), `${git(['rev-parse', 'HEAD'])}\n`)
  const receipt = captureCiSource(root, '.github/workflows/ci.yml', context)
  expect(receipt.parents).toEqual([context.DSH_CI_CANDIDATE_SHA])
  expect(receipt.checkoutSha).not.toBe(context.DSH_CI_CANDIDATE_SHA)
})

it('marks both untracked and staged changes dirty', () => {
  const { root, git, context } = fixture()
  writeFileSync(join(root, 'changed.txt'), 'changed\n')
  expect(captureCiSource(root, '.github/workflows/ci.yml', context).dirty).toBe(true)
  git(['add', '.'])
  expect(captureCiSource(root, '.github/workflows/ci.yml', context).dirty).toBe(true)
})

it('rejects absent run identity and workflow path traversal', () => {
  const { root, context } = fixture()
  expect(() => captureCiSource(root, '.github/workflows/ci.yml', {})).toThrow()
  expect(() => captureCiSource(root, '../ci.yml', context)).toThrow('canonical workflow path')
  expect(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).toBe('name: Fixture\n')
})
