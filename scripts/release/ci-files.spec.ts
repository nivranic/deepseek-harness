/** The executed required-check verifier rejects workflow and generated-file drift. */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { removeFixtureSafely } from '../test-fixture-cleanup.ts'
import { readRequiredChecks, renderRequiredChecks, REQUIRED_CHECKS_FILE, verifyRequiredChecks } from './ci-files.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSafely(root) })

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-required-checks-'))
  roots.push(root)
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  mkdirSync(join(root, 'release'))
  for (const name of ['ci.yml', 'apple-swift.yml', 'android-kotlin.yml']) {
    const relative = `.github/workflows/${name}`
    copyFileSync(resolve(import.meta.dirname, '../..', relative), join(root, relative))
  }
  writeFileSync(join(root, REQUIRED_CHECKS_FILE), renderRequiredChecks(readRequiredChecks(root)))
  return root
}

it('accepts a current projection and rejects changed metadata', () => {
  const root = fixture()
  expect(() => { verifyRequiredChecks(root) }).not.toThrow()
  writeFileSync(join(root, REQUIRED_CHECKS_FILE), '{}\n')
  expect(() => { verifyRequiredChecks(root) }).toThrow('stale')
})

it('rejects changes to a required workflow even when the job names stay the same', () => {
  const root = fixture()
  const path = join(root, '.github/workflows/apple-swift.yml')
  writeFileSync(path, `${readFileSync(path, 'utf8')}# changed execution input\n`)
  expect(() => { verifyRequiredChecks(root) }).toThrow('stale')
})
