/**
 * Regenerate the link-contract artifacts under
 * `packages/remote/link-contracts/generated/` from the declarative table and
 * golden fixtures. Pure CLI for `pnpm run gen-link-contracts`; the drift gate
 * is `verify-link-contracts`.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateLinkContracts } from '../packages/remote/link-contracts/src/generate.ts'

const root = resolve(import.meta.dirname, '..')
const dir = resolve(root, 'packages/remote/link-contracts/generated')
const artifacts = generateLinkContracts()
writeFileSync(resolve(dir, 'link-contracts.manifest.json'), artifacts.manifest)
writeFileSync(resolve(dir, 'LinkContracts.swift'), artifacts.swift)
writeFileSync(resolve(dir, 'LinkContracts.kt'), artifacts.kotlin)
console.log('gen-link-contracts: wrote manifest, Swift, and Kotlin artifacts.')
