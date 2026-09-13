/** Verify local candidate integrity without executing artifacts or publishing a release. */
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readProductIdentity } from './release/product-files.ts'
import { verifyRcArtifacts, verifyRcPlatform } from './release/rc-artifacts.ts'
import { parseRcJson, RC_READ_FLAGS } from './release/rc-files.ts'
import { classifyRcAdvance, parseRcManifest, parseRcPolicy } from './release/rc-manifest.ts'

async function readJson(path: string, limit: number): Promise<unknown> {
  const file = await open(path, RC_READ_FLAGS)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('RC input must be a regular JSON file within the byte limit')
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const value of file.createReadStream({ autoClose: false })) {
      const chunk: unknown = value
      if (!Buffer.isBuffer(chunk)) throw new Error('RC JSON input must be bytes')
      bytes += chunk.length
      if (bytes > limit) throw new Error('RC JSON exceeds the byte limit')
      chunks.push(chunk)
    }
    return parseRcJson(Buffer.concat(chunks))
  } finally {
    await file.close()
  }
}

/**
 * Run the read-only verifier with independent expected source and checkout-owned identity.
 * @param args - strict CLI options; --manifest and --receipt are mutually exclusive.
 * @param repository - checkout that owns release policy and product identity.
 * @returns a payload-free integrity summary, with distribution advancement only when requested.
 */
export async function verifyRcCandidate(args: string[], repository: string): Promise<Record<string, unknown>> {
  const { values } = parseArgs({ args, options: {
    root: { type: 'string' }, manifest: { type: 'string' }, receipt: { type: 'string' },
    'source-sha': { type: 'string' }, 'source-repository': { type: 'string' },
    previous: { type: 'string' }, 'max-json-bytes': { type: 'string', default: String(32 * 1024 * 1024) },
  } })
  if (!values.root || !values['source-sha'] || !values['source-repository'] || Boolean(values.manifest) === Boolean(values.receipt)) {
    throw new Error('require --root, --source-sha, --source-repository and exactly one of --manifest or --receipt')
  }
  if (values.previous && !values.manifest) throw new Error('--previous requires a complete --manifest')
  const maxJsonBytes = Number(values['max-json-bytes'])
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes <= 0) throw new Error('--max-json-bytes must be a positive integer')
  const policy = parseRcPolicy(await readJson(resolve(repository, 'release/rc-policy.json'), maxJsonBytes))
  const expected = { sourceSha: values['source-sha'], sourceRepository: values['source-repository'], identity: readProductIdentity(repository), maxJsonBytes }
  const inputPath = values.manifest ?? values.receipt
  if (inputPath === undefined) throw new Error('RC input file is required')
  const input = await readJson(resolve(inputPath), maxJsonBytes)
  if (values.receipt) {
    const receipt = await verifyRcPlatform(resolve(values.root), input, policy, expected)
    return { status: 'PASS', scope: 'platform', platform: receipt.platform, sourceSha: receipt.sourceSha, authenticated: false }
  }
  const manifest = await verifyRcArtifacts(resolve(values.root), input, policy, expected)
  const advancement = values.previous
    ? classifyRcAdvance(parseRcManifest(await readJson(resolve(values.previous), maxJsonBytes), policy), manifest)
    : 'not-checked'
  return { status: 'PASS', scope: 'candidate', sourceSha: manifest.sourceSha, platforms: manifest.platforms.length, advancement, authenticated: false }
}

if (import.meta.main) console.log(JSON.stringify(await verifyRcCandidate(process.argv.slice(2), resolve(import.meta.dirname, '..'))))
