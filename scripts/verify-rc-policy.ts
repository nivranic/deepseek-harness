/** Reject malformed or incomplete platform requirements through the executed source-check aggregates. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseRcPolicy } from './release/rc-manifest.ts'

const path = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../release/rc-policy.json'))
const policy = parseRcPolicy(JSON.parse(readFileSync(path, 'utf8')) as unknown)
console.log(`verify-rc-policy: ${policy.platforms.length} platform requirements parsed; no artifact acceptance performed`)
