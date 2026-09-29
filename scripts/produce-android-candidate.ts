/** Produce the Android platform receipt from one immutable checkout on a disposable emulator runner. */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { recordAndroidCandidate } from './release/android-candidate-receipt.ts'
import { readProductIdentity } from './release/product-files.ts'
import { withRcCleanup } from './release/rc-lifecycle.ts'
import { parseRcPolicy } from './release/rc-manifest.ts'
import { writeRcOutput } from './release/rc-output.ts'

const execute = promisify(execFile)
const repository = resolve(import.meta.dirname, '..')
if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.RUNNER_OS !== 'Linux') {
  throw new Error('Android candidate requires disposable GitHub-hosted Linux')
}
const { values } = parseArgs({ options: { output: { type: 'string' } } })
const sourceSha = process.env.DSH_RC_SOURCE_SHA, runnerTemp = process.env.RUNNER_TEMP
const githubRepository = process.env.GITHUB_REPOSITORY, runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT
if (values.output === undefined || runnerTemp === undefined || sourceSha === undefined || !/^[a-f0-9]{40}$/.test(sourceSha)
  || githubRepository === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepository)
  || runId === undefined || !/^[0-9]+$/.test(runId) || attempt === undefined || !/^[0-9]+$/.test(attempt)) {
  throw new Error('Android candidate requires output, immutable source and GitHub invocation identity')
}
const output = resolve(values.output), temporary = resolve(runnerTemp)
if (!output.startsWith(`${temporary}${sep}`)) throw new Error('Android candidate output must be beneath RUNNER_TEMP')
const actualSha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
if (actualSha !== sourceSha) throw new Error('Android candidate checkout differs from requested SHA')
const identity = readProductIdentity(repository)
const work = await mkdtemp(join(temporary, 'dsh-android-receipt-'))
await withRcCleanup(async () => {
  await mkdir(output)
  await mkdir(join(output, 'android'))
  const request = await writeRcOutput(work, 'request.json', { sourceSha, identity })
  await copyFile(join(repository, 'apps/android/app/build/outputs/bundle/release/app-release.aab'), join(output, 'android/app.aab'))
  await copyFile(join(repository, 'apps/android/app/build/outputs/mapping/release/mapping.txt'), join(output, 'android/mapping.txt'))
  const produced = await execute('python3', ['-B', join(repository, 'scripts/release/android_candidate.py'),
    '--output', join(output, 'android'), '--request', join(work, request.path)], { cwd: repository, timeout: 1_800_000 })
  process.stdout.write(produced.stdout)
  const policy = parseRcPolicy(JSON.parse(await readFile(join(repository, 'release/rc-policy.json'), 'utf8')) as unknown)
  await recordAndroidCandidate(output, policy, { sourceSha, identity, maxJsonBytes: 32 * 1024 * 1024,
    sourceRepository: `git+https://github.com/${githubRepository}`,
    builderId: `https://github.com/${githubRepository}/blob/${sourceSha}/.github/workflows/android-candidate.yml`,
    invocationId: `https://github.com/${githubRepository}/actions/runs/${runId}/attempts/${attempt}` })
}, async () => {
  if (!work.startsWith(`${temporary}${sep}dsh-android-receipt-`)) throw new Error('Refusing Android receipt cleanup outside the owned directory')
  await rm(work, { recursive: true })
})
console.log(JSON.stringify({ status: 'PASS', scope: 'android-platform', sourceSha, authenticated: false }))
