/**
 * Link-contract drift gate: regenerate the manifest, Swift, and Kotlin
 * artifacts in memory and require the committed files to match byte-for-byte.
 * A wire-type change that regenerates differently fails here until the
 * artifacts are regenerated and reviewed, the same contract drift CI the
 * nativization plan (chapter 19) mandates.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateLinkContracts } from '../packages/remote/link-contracts/src/generate.ts'

const root = resolve(import.meta.dirname, '..')
const dir = resolve(root, 'packages/remote/link-contracts/generated')
const expected: ReadonlyArray<[name: string, actual: string]> = [
  ['link-contracts.manifest.json', readFileSync(resolve(dir, 'link-contracts.manifest.json'), 'utf8')],
  ['LinkContracts.swift', readFileSync(resolve(dir, 'LinkContracts.swift'), 'utf8')],
  ['LinkContracts.kt', readFileSync(resolve(dir, 'LinkContracts.kt'), 'utf8')],
]
const artifacts = generateLinkContracts()
let failed = false
for (const [name, actual] of expected) {
  const wanted = name.endsWith('.json') ? artifacts.manifest : name.endsWith('.swift') ? artifacts.swift : artifacts.kotlin
  if (actual !== wanted) {
    failed = true
    console.error(`verify-link-contracts: ${name} is stale. Run \`pnpm run gen-link-contracts\` and commit the result.`)
  }
}
if (failed) process.exit(1)
console.log('verify-link-contracts: manifest, Swift, and Kotlin artifacts are fresh.')
