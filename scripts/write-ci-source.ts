/** Write the workflow's actual checkout receipt and reject changed source inputs. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { captureCiSource } from './release/ci-source.ts'

const [workflow, output] = process.argv.slice(2)
if (workflow === undefined || output === undefined) throw new Error('usage: write-ci-source.ts <workflow-path> <receipt.json>')
const receipt = captureCiSource(process.cwd(), workflow, process.env)
mkdirSync(dirname(resolve(output)), { recursive: true })
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`)
if (receipt.dirty) throw new Error('CI source checkout is dirty before validation')
console.log(`CI source receipt: ${receipt.checkoutSha} (${receipt.treeSha})`)
