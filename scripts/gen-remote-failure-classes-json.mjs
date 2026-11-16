/**
 * Project REMOTE_FAILURE_CLASSES from the TypeScript authority into the JSON
 * consumed by the Kotlin contract tests and the Swift self-check executable,
 * and refresh the schema copies the Swift check reads. Run through tsx to
 * read the source authority; --check validates without writing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { REMOTE_FAILURE_CLASSES } from '../packages/typert/protocol/src/failure-classes.ts'

const root = resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: gen-remote-failure-classes-json.mjs [--check]')
const output = 'apps/android/contract/src/test/resources/generated/remote-failure-classes.json'
const appleFixtures = 'apps/apple/contract/fixtures'
const projection = JSON.stringify(REMOTE_FAILURE_CLASSES, null, 2) + '\n'
const outputs = new Map([[output, projection], [`${appleFixtures}/remote-failure-classes.json`, projection]])
for (const schema of ['remote-errors.schema.json', 'remote-error-codes.schema.json']) {
  outputs.set(`${appleFixtures}/${schema}`, readFileSync(resolve(root, 'packages/typert/protocol', schema), 'utf8'))
}
for (const [relative, content] of outputs) {
  const path = resolve(root, relative)
  if (check) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`${relative} is stale; run pnpm run gen-remote-failure-classes`)
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}
console.log(`Remote failure Client fixtures: ${check ? 'current' : 'generated'}; ${Object.keys(REMOTE_FAILURE_CLASSES).length} classified codes`)
