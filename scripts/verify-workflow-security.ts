/** Enforce immutable Action revisions and the repository's explicit token-permission policy. */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inspectWorkflowSecurity } from './workflow-security.ts'

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'))
const directory = join(root, '.github/workflows')
const files = new Map(readdirSync(directory).filter(name => /\.ya?ml$/.test(name))
  .map(name => [name, readFileSync(join(directory, name), 'utf8')]))
const pins: unknown = JSON.parse(readFileSync(join(root, 'release/action-pins.json'), 'utf8'))
const policy: unknown = JSON.parse(readFileSync(join(root, 'release/workflow-security.json'), 'utf8'))
const errors = inspectWorkflowSecurity(files, pins, policy)
if (errors.length !== 0) throw new Error(`workflow security violations:\n${errors.join('\n')}`)
console.log(`verify-workflow-security: ${files.size} workflows satisfy action and permission policy`)
