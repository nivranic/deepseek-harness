/**
 * Link-contract drift gate: regenerate every artifact in memory — the
 * manifest, Swift, and Kotlin texts, one JSON body per golden fixture, and
 * the domain-state conformance scenarios (records plus the reference fold's
 * expected state) — and require the committed files, including the synced
 * `apps/apple` copies, to match byte-for-byte. A wire-type or fold change
 * that regenerates differently fails here until the artifacts are
 * regenerated and reviewed, the contract drift CI the nativization plan
 * (chapters 19 and 62) mandates.
 */

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { LINK_CONTRACT_FIXTURES } from '../packages/remote/link-contracts/src/index.ts'
import { generateLinkContracts } from '../packages/remote/link-contracts/src/generate.ts'
import { generateConformanceArtifacts } from '../packages/remote/link-contracts/src/companion-scenarios.ts'
import { generateLiteConformance } from '../packages/remote/link-contracts/src/lite-spec.ts'

const root = resolve(import.meta.dirname, '..')
const generatedDir = resolve(root, 'packages/remote/link-contracts/generated')
const appleSources = resolve(root, 'apps/apple/Sources/SharedAppleRemoteCore')
const appleFixtures = resolve(root, 'apps/apple/Tests/SharedAppleRemoteCoreTests/Fixtures')
const appleUiConformance = resolve(root, 'apps/apple/Tests/CompanionUITests/Fixtures/conformance')
const appleLite = resolve(root, 'apps/apple/Tests/LiteRuntimeTests/Fixtures/lite-conformance')
const androidKotlin = resolve(root, 'apps/android/core/src/main/kotlin/ai/deepseek/dsh/link')
const androidFixtures = resolve(root, 'apps/android/core/src/test/resources/fixtures')
const androidConformance = resolve(root, 'apps/android/core/src/test/resources/conformance')

const artifacts = generateLinkContracts()
const conformance = generateConformanceArtifacts()
const lite = generateLiteConformance()
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
expectFresh(resolve(androidKotlin, 'LinkContracts.kt'), artifacts.kotlin)
for (const fixture of LINK_CONTRACT_FIXTURES) {
  const json = `${JSON.stringify(fixture.value, undefined, 2)}
`
  expectFresh(resolve(generatedDir, 'fixtures', `${fixture.id}.json`), json)
  expectFresh(resolve(appleFixtures, `${fixture.id}.json`), json)
  expectFresh(resolve(androidFixtures, `${fixture.id}.json`), json)
}
for (const scenario of conformance) {
  expectFresh(resolve(generatedDir, 'conformance', `${scenario.id}.json`), scenario.json)
  expectFresh(resolve(appleFixtures, 'conformance', `${scenario.id}.json`), scenario.json)
  expectFresh(resolve(appleUiConformance, `${scenario.id}.json`), scenario.json)
  expectFresh(resolve(androidConformance, `${scenario.id}.json`), scenario.json)
}
for (const scenario of lite) {
  expectFresh(resolve(generatedDir, 'lite-conformance', `${scenario.id}.json`), scenario.json)
  expectFresh(resolve(appleLite, `${scenario.id}.json`), scenario.json)
}
if (failures > 0) process.exit(1)
console.log('verify-link-contracts: manifest, Swift, Kotlin, fixture, conformance, and Lite conformance artifacts are fresh (apps/apple and apps/android synced).')
