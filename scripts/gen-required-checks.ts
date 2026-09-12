/** Generate required workflow jobs and source digests from their canonical YAML. */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readRequiredChecks, renderRequiredChecks, REQUIRED_CHECKS_FILE } from './release/ci-files.ts'

const root = resolve(import.meta.dirname, '..')
writeFileSync(join(root, REQUIRED_CHECKS_FILE), renderRequiredChecks(readRequiredChecks(root)))
console.log(`gen-required-checks: wrote ${REQUIRED_CHECKS_FILE}`)
