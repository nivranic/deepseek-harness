/**
 * Link-contract drift gate: regenerate every artifact in memory — the
 * manifest, Swift, and Kotlin texts, and one JSON body per golden fixture —
 * and require the committed files, including the synced `apps/apple` copies,
 * to match byte-for-byte. A wire-type change that regenerates differently
 * fails here until the artifacts are regenerated and reviewed, the contract
 * drift CI the nativization plan (chapter 19) mandates.
 */

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { LINK_CONTRACT_FIXTURES } from '../packages/remote/link-contracts/src/index.ts'
import { generateLinkContracts } from '../packages/remote/link-contracts/src/generate.ts'

const root = resolve(import.meta.dirname, '..')
const generatedDir = resolve(root, 'packages/remote/link-contracts/generated')
const appleSources = resolve(root, 'apps/apple/Sources/SharedAppleRemoteCore')
const appleFixtures = resolve(root, 'apps/apple/Tests/SharedAppleRemoteCoreTests/Fixtures')

const artifacts = generateLinkContracts()
let failures = 0
const expectFresh = (path: string, wanted: string): void => {
  let actual: string | undefined
  try {
    actual = readFileSync(path, 'utf8')
  } catch {
    failures += 1
    console.error(`verify-link-contracts: ${relative(root, path)} is missing. Run \`pnpm run gen-link-contracts\`.`)
    return
  }
  if (actual !== wanted) {
    failures += 1
    console.error(`verify-link-contracts: ${relative(root, path)} is stale. Run \`pnpm run gen-link-contracts\` and commit the result.`)
  }
}

expectFresh(resolve(generatedDir, 'link-contracts.manifest.json'), artifacts.manifest)
expectFresh(resolve(generatedDir, 'LinkContracts.swift'), artifacts.swift)
expectFresh(resolve(generatedDir, 'LinkContracts.kt'), artifacts.kotlin)
expectFresh(resolve(appleSources, 'LinkContracts.swift'), artifacts.swift)
for (const fixture of LINK_CONTRACT_FIXTURES) {
  const json = `${JSON.stringify(fixture.value, undefined, 2)}
`
  expectFresh(resolve(generatedDir, 'fixtures', `${fixture.id}.json`), json)
  expectFresh(resolve(appleFixtures, `${fixture.id}.json`), json)
}
if (failures > 0) process.exit(1)
console.log('verify-link-contracts: manifest, Swift, Kotlin, and fixture artifacts are fresh (apps/apple synced).')
