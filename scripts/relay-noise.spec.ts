/** Run the Node reference's keyless crypto corpus in the ordinary repository test gate. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('keeps both native fixtures byte-identical to the canonical Node vectors', () => {
  const canonical = readFileSync(new URL('../apps/relay/vectors/relay-noise-vectors.json', import.meta.url))
  for (const path of [
    '../apps/android/core/src/test/resources/fixtures/relay-noise-vectors.json',
    '../apps/apple/Tests/SharedAppleRemoteCoreTests/Fixtures/relay-noise-vectors.json',
  ]) {
    expect(readFileSync(new URL(path, import.meta.url))).toEqual(canonical)
  }
})

it('runs the shared Noise boundary and authentication corpus through the Node reference', () => {
  const files = ['noise.test.mjs', 'server.test.mjs'].map(file =>
    fileURLToPath(new URL(`../apps/relay/${file}`, import.meta.url)))
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { encoding: 'utf8', timeout: 15_000 })
  expect(output).toMatch(/# fail 0/u)
}, 20_000)

it('retires exhausted keys and orders real relay HTTP exchanges', () => {
  const file = fileURLToPath(new URL('../apps/relay/selftest.mjs', import.meta.url))
  const output = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 })
  expect(output).toContain('relay selftest: all assertions hold')
}, 25_000)
