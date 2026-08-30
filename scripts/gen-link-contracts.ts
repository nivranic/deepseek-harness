/**
 * Regenerate the link-contract artifacts: the in-package manifest, Swift,
 * and Kotlin texts under `packages/remote/link-contracts/generated/`, one
 * JSON file per golden fixture beside them, and the synced Swift-model and
 * fixture copies under `apps/apple/` that the Shared Apple Remote Core and
 * its fixture-replay tests consume. Pure CLI for
 * `pnpm run gen-link-contracts`; the drift gate is `verify-link-contracts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LINK_CONTRACT_FIXTURES } from '../packages/remote/link-contracts/src/index.ts'
import { generateLinkContracts } from '../packages/remote/link-contracts/src/generate.ts'
import { generateConformanceArtifacts } from '../packages/remote/link-contracts/src/companion-scenarios.ts'
import { generateLiteConformance } from '../packages/remote/link-contracts/src/lite-spec.ts'

const root = resolve(import.meta.dirname, '..')
const generatedDir = resolve(root, 'packages/remote/link-contracts/generated')
const fixturesDir = resolve(generatedDir, 'fixtures')
const conformanceDir = resolve(generatedDir, 'conformance')
const appleSources = resolve(root, 'apps/apple/Sources/SharedAppleRemoteCore')
const appleFixtures = resolve(root, 'apps/apple/Tests/SharedAppleRemoteCoreTests/Fixtures')
const appleConformance = resolve(appleFixtures, 'conformance')
const generatedLiteDir = resolve(generatedDir, 'lite-conformance')
const appleLite = resolve(appleFixtures, 'lite-conformance')
const appleUiConformance = resolve(root, 'apps/apple/Tests/CompanionUITests/Fixtures/conformance')

const artifacts = generateLinkContracts()
writeFileSync(resolve(generatedDir, 'link-contracts.manifest.json'), artifacts.manifest)
writeFileSync(resolve(generatedDir, 'LinkContracts.swift'), artifacts.swift)
writeFileSync(resolve(generatedDir, 'LinkContracts.kt'), artifacts.kotlin)
writeFileSync(resolve(appleSources, 'LinkContracts.swift'), artifacts.swift)

mkdirSync(fixturesDir, { recursive: true })
mkdirSync(appleFixtures, { recursive: true })
for (const fixture of LINK_CONTRACT_FIXTURES) {
  const json = `${JSON.stringify(fixture.value, undefined, 2)}\n`
  writeFileSync(resolve(fixturesDir, `${fixture.id}.json`), json)
  writeFileSync(resolve(appleFixtures, `${fixture.id}.json`), json)
}

mkdirSync(conformanceDir, { recursive: true })
mkdirSync(appleConformance, { recursive: true })
mkdirSync(appleUiConformance, { recursive: true })
for (const scenario of generateConformanceArtifacts()) {
  writeFileSync(resolve(conformanceDir, `${scenario.id}.json`), scenario.json)
  writeFileSync(resolve(appleConformance, `${scenario.id}.json`), scenario.json)
  writeFileSync(resolve(appleUiConformance, `${scenario.id}.json`), scenario.json)
}

mkdirSync(generatedLiteDir, { recursive: true })
mkdirSync(appleLite, { recursive: true })
for (const scenario of generateLiteConformance()) {
  writeFileSync(resolve(generatedLiteDir, `${scenario.id}.json`), scenario.json)
  writeFileSync(resolve(appleLite, `${scenario.id}.json`), scenario.json)
}
console.log('gen-link-contracts: wrote manifest, Swift, Kotlin, fixture, conformance, and Lite conformance artifacts (apps/apple synced).')
