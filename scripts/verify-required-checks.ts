/** Reject required-check metadata that no longer matches its workflow owners. */
import { resolve } from 'node:path'
import { verifyRequiredChecks } from './release/ci-files.ts'

verifyRequiredChecks(resolve(process.argv[2] ?? resolve(import.meta.dirname, '..')))
console.log('verify-required-checks: required jobs and workflow digests match')
