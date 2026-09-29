/** Static validation of release-foundation coverage, separate from candidate acceptance. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseReleaseChecklist } from './release/governance.ts'

const path = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../release/checklist.json'))
const checklist = parseReleaseChecklist(JSON.parse(readFileSync(path, 'utf8')) as unknown)
console.log(`verify-release-checklist: ${checklist.engineering.length} engineering and ${checklist.production.length} production requirements; no candidate acceptance performed`)
