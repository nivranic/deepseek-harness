/** Bind native diagnostic counts to the exact clean candidate checkout and application identity. */
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { captureCiSource } from './release/ci-source.ts'
import { collectProductDiagnosticFile } from './release/diagnostic-files.ts'
import { readProductIdentity, staleProductIdentityFiles } from './release/product-files.ts'

let stage = 'arguments'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    platform: { type: 'string' }, directory: { type: 'string' }, 'max-input-bytes': { type: 'string' },
  }, allowPositionals: false })
  if ((values.platform !== 'windows' && values.platform !== 'macos') || values.directory === undefined
    || values['max-input-bytes'] === undefined) throw new Error('native diagnostic collector arguments are required')
  const repository = process.cwd()
  const workflow = values.platform === 'windows' ? '.github/workflows/windows-candidate.yml' : '.github/workflows/mac-host-candidate.yml'
  const environment = { ...process.env, DSH_CI_CANDIDATE_SHA: process.env.DSH_RC_SOURCE_SHA }
  stage = 'source-metadata'
  const source = captureCiSource(repository, workflow, environment)
  stage = 'source-clean'
  if (source.dirty) throw new Error('diagnostic collection requires a clean candidate')
  stage = 'source-candidate'
  if (source.checkoutSha !== source.candidateSha) throw new Error('diagnostic collection requires the exact candidate')
  stage = 'product-identity'
  const identity = readProductIdentity(repository)
  stage = 'product-freshness'
  if (staleProductIdentityFiles(repository, identity).length !== 0) throw new Error('diagnostic product identity is stale')
  stage = 'native-report'
  await collectProductDiagnosticFile(resolve(values.directory), {
    version: identity.version, buildNumber: identity.buildNumber, channel: identity.channel,
    sourceSha: source.candidateSha, platform: values.platform, runtimeClass: 'full',
  }, Number(values['max-input-bytes']))
}

void main().catch(() => {
  // File and argument errors can contain private input; only a locally assigned stage is public.
  console.error(`product diagnostic collection failed: ${stage}`)
  process.exitCode = 1
})
