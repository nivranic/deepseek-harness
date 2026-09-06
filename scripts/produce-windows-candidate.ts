/** Produce a verified Windows candidate receipt on a disposable runner after official packaging. */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { readProductIdentity } from './release/product-files.ts'
import { verifyRcPlatform } from './release/rc-artifacts.ts'
import { RC_BUILD_TYPE, rcSubjects } from './release/rc-evidence.ts'
import { parseRcPolicy, type RcPlatformReceipt } from './release/rc-manifest.ts'
import { withRcCleanup } from './release/rc-lifecycle.ts'
import { describeRcOutput, hashRcOutput, writeRcOutput } from './release/rc-output.ts'
import { parseSyftReceipt } from './release/sbom-receipt.ts'
import { installWindowsCandidate, requireHostedWindows, smokeWindowsCandidate, windowsCandidateEnvironment } from './release/windows-smoke.ts'

const execute = promisify(execFile)
const repository = resolve(import.meta.dirname, '..')
requireHostedWindows(process.platform, process.env)
const { values } = parseArgs({ options: { output: { type: 'string' } } })
if (values.output === undefined) throw new Error('require --output beneath RUNNER_TEMP')
const runnerTemp = process.env.RUNNER_TEMP, sourceSha = process.env.DSH_RC_SOURCE_SHA
const githubRepository = process.env.GITHUB_REPOSITORY, runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT
if (runnerTemp === undefined || sourceSha === undefined || sourceSha.length !== 40 || !/^[a-f0-9]{40}$/.test(sourceSha)
  || githubRepository === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository)
  || runId === undefined || !/^[0-9]+$/.test(runId) || attempt === undefined || !/^[0-9]+$/.test(attempt)) {
  throw new Error('Windows candidate requires an immutable source and GitHub invocation identity')
}
const output = resolve(values.output), temporary = resolve(runnerTemp)
if (!output.toLowerCase().startsWith(`${temporary.toLowerCase()}\\`)) throw new Error('Windows candidate output must be beneath RUNNER_TEMP')
const actualSha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
if (actualSha !== sourceSha) throw new Error('Windows candidate checkout differs from the requested SHA')
const identity = readProductIdentity(repository)
const work = await mkdtemp(join(temporary, 'dsh-windows-rc-'))
const sourceRepository = `git+https://github.com/${githubRepository}`
const builderId = `https://github.com/${githubRepository}/blob/${sourceSha}/.github/workflows/windows-candidate.yml`
const invocationId = `https://github.com/${githubRepository}/actions/runs/${runId}/attempts/${attempt}`

await withRcCleanup(async () => {
  await mkdir(output)
  await mkdir(join(output, 'windows'))
  const packaged = join(repository, 'dist-desktop/out'), unpacked = join(packaged, 'win-unpacked')
  const installer = join(output, 'windows/installer.exe'), portable = join(output, 'windows/portable.exe')
  await copyFile(join(packaged, `DeepSeek Harness Setup ${identity.version}.exe`), installer)
  await copyFile(join(packaged, `DeepSeek Harness ${identity.version}.exe`), portable)
  const artifacts = [
    { ...await describeRcOutput(output, 'windows/installer.exe'), kind: 'installer' as const, runtimeClass: 'full' as const, signing: 'unsigned' as const },
    { ...await describeRcOutput(output, 'windows/portable.exe'), kind: 'portable' as const, runtimeClass: 'full' as const, signing: 'unsigned' as const },
  ]
  const installDirectory = join(work, 'installed')
  console.log('Windows candidate: install start')
  await installWindowsCandidate(installer, installDirectory)
  console.log('Windows candidate: install complete')
  const installedExecutable = join(installDirectory, 'DeepSeek Harness.exe')
  const originalExecutable = join(unpacked, 'DeepSeek Harness.exe')
  const originalHash = await hashRcOutput(originalExecutable), installedHash = await hashRcOutput(installedExecutable)
  if (originalHash.sha256 !== installedHash.sha256) throw new Error('Installed main executable differs from the packaged executable')
  const versionInput = join(work, 'version-input.json'), versionOutput = join(work, 'version-output.json')
  await writeFile(versionInput, JSON.stringify({ identity, files: [installer, portable, originalExecutable, installedExecutable] }))
  await execute('pwsh', ['-NoProfile', '-File', join(repository, 'scripts/release/verify-windows-product.ps1'),
    '-InputFile', versionInput, '-OutputFile', versionOutput], { windowsHide: true, env: windowsCandidateEnvironment(process.env) })
  console.log('Windows candidate: installed bytes and PE versions verified; installed GUI start')
  const installed = await smokeWindowsCandidate(installedExecutable, join(work, 'installed-state'), join(output, 'windows/installed.png'))
  console.log('Windows candidate: installed GUI passed; portable GUI start')
  const portableStartup = await smokeWindowsCandidate(portable, join(work, 'portable-state'), join(output, 'windows/portable.png'))
  console.log('Windows candidate: portable GUI passed')
  for (const startup of [installed, portableStartup]) {
    if (startup.applicationVersion !== identity.version || startup.executableSha256 !== originalHash.sha256) {
      throw new Error('The running application differs from the packaged version or executable bytes')
    }
  }
  const toolReceiptPath = join(work, 'syft-tool.json')
  await execute('python', [join(repository, 'scripts/release/sbom.py'), '--directory', unpacked,
    '--npm-root', join(unpacked, 'resources/app'), '--output', join(output, 'windows/sbom.cdx.json'),
    '--tool-receipt', toolReceiptPath], { timeout: 1_200_000, windowsHide: true, env: windowsCandidateEnvironment(process.env) })
  const toolReceipt = parseSyftReceipt(JSON.parse(await readFile(toolReceiptPath, 'utf8')) as unknown,
    JSON.parse(await readFile(join(repository, '.github/security/scanners.json'), 'utf8')) as unknown)
  const sbom = { ...await describeRcOutput(output, 'windows/sbom.cdx.json'), format: 'cyclonedx-1.6' as const,
    tool: { name: toolReceipt.name, version: toolReceipt.version } }
  const checks: RcPlatformReceipt['checks'] = []
  for (const name of ['identity', 'startup', 'npm-inventory']) {
    const file = await writeRcOutput(output, `windows/${name}.json`, {
      schemaVersion: 1, name, sourceSha, identity, platform: 'windows', status: 'PASS', subjects: rcSubjects(artifacts),
    })
    checks.push({ ...file, name })
  }
  const attachments = [
    await describeRcOutput(output, 'windows/installed.png'),
    await describeRcOutput(output, 'windows/portable.png'),
    await writeRcOutput(output, 'windows/observations.json', {
      sourceSha, identity, installed, portable: portableStartup, sbomTool: toolReceipt,
      versions: JSON.parse((await readFile(versionOutput, 'utf8')).replace(/^\uFEFF/, '')) as unknown,
    }),
  ]
  const provenanceFile = await writeRcOutput(output, 'windows/provenance.json', {
    _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
    subject: rcSubjects([...artifacts, ...checks, ...attachments, sbom]),
    predicate: {
      buildDefinition: {
        buildType: RC_BUILD_TYPE, externalParameters: { sourceSha, identity, platform: 'windows' },
        resolvedDependencies: [{ uri: sourceRepository, digest: { gitCommit: sourceSha } }],
      },
      runDetails: { builder: { id: builderId }, metadata: { invocationId } },
    },
  })
  const receipt: RcPlatformReceipt = {
    schemaVersion: 1, sourceSha, identity, platform: 'windows', artifacts, checks, attachments, sbom,
    provenance: { ...provenanceFile, builderId, invocationId },
  }
  const policy = parseRcPolicy(JSON.parse(await readFile(join(repository, 'release/rc-policy.json'), 'utf8')) as unknown)
  await verifyRcPlatform(output, receipt, policy, { sourceSha, sourceRepository, identity, maxJsonBytes: 32 * 1024 * 1024 })
  await writeRcOutput(output, 'windows/receipt.json', receipt)
}, async () => {
  if (!work.toLowerCase().startsWith(`${temporary.toLowerCase()}\\dsh-windows-rc-`)) throw new Error('Refusing cleanup outside the owned run directory')
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
console.log(JSON.stringify({ status: 'PASS', scope: 'windows-platform', sourceSha, authenticated: false }))
