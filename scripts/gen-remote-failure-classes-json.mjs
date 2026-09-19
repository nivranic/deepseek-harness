/**
 * Project REMOTE_FAILURE_CLASSES from the TypeScript authority into the JSON
 * consumed by the Kotlin contract tests. Run after `pnpm run build:lib` so
 * the built protocol package exposes the current map.
 */
import { writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const { REMOTE_FAILURE_CLASSES } = await import('../packages/typert/protocol/lib/index.js')
const output = 'apps/android/contract/src/test/resources/generated/remote-failure-classes.json'
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(REMOTE_FAILURE_CLASSES, null, 2) + '\n')
console.log(`${output}: ${String(Object.keys(REMOTE_FAILURE_CLASSES).length)} classified codes projected`)
