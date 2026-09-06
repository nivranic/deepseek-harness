import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { describeRcOutput, writeRcOutput } from './release/rc-output.ts'
import { withRcCleanup } from './release/rc-lifecycle.ts'
import { parseSyftReceipt } from './release/sbom-receipt.ts'
import { requireHostedWindows, waitForRcProcessExit, windowsCandidateEnvironment } from './release/windows-smoke.ts'

const repository = resolve(import.meta.dirname, '..')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Windows candidate production requirements', () => {
  it('retains both operation and cleanup failures in order, including a non-Error operation failure', async () => {
    const disposal = new Error('owned directory is busy')
    for (const failure of [new Error('GUI startup failed'), undefined]) {
      let cleanupCalls = 0
      await expect(withRcCleanup(async () => { throw failure }, async () => {
        cleanupCalls++
        throw disposal
      })).rejects.toMatchObject({ errors: [failure, disposal] })
      expect(cleanupCalls).toBe(1)
    }
  })

  it('returns only after cleanup and preserves single failures', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let completed = false
    const result = withRcCleanup(async () => 123, async () => {
      entered.resolve(undefined)
      await release.promise
    }).then((value) => { completed = true; return value })
    await entered.promise
    expect(completed).toBe(false)
    release.resolve(undefined)
    expect(await result).toBe(123)
    const failure = new Error('failure')
    let cleaned = false
    await expect(withRcCleanup(async () => { throw failure }, async () => { cleaned = true })).rejects.toBe(failure)
    expect(cleaned).toBe(true)
    await expect(withRcCleanup(async () => 123, async () => { throw failure })).rejects.toBe(failure)
  })

  it('loads the post-packaging producer through Node and refuses a persistent host before installation', async () => {
    await expect(promisify(execFile)(process.execPath, [
      '--import', 'tsx/esm', 'scripts/produce-windows-candidate.ts', '--output', 'must-not-be-created',
    ], { cwd: repository, env: { ...process.env, GITHUB_ACTIONS: 'false' }, windowsHide: true }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('require a disposable GitHub-hosted Windows runner') as unknown })
  }, 30_000)

  it('joins real process exit and reports timeout independently of eventual success', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 50)'], { stdio: 'ignore', windowsHide: true })
    await expect(waitForRcProcessExit(child, 1)).rejects.toThrow('deadline')
    expect(await waitForRcProcessExit(child, 5_000)).toBe(0)
    expect(await waitForRcProcessExit(child, 1)).toBe(0)
  })
  it('does not forward ambient credentials or development hooks into the application', () => {
    expect(windowsCandidateEnvironment({ Path: 'tools', TEMP: 'temporary', GITHUB_TOKEN: 'synthetic',
      DEEPSEEK_API_KEY: 'synthetic', Password: 'synthetic', Node_Options: '--require=hook',
      ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_SMOKE_SHOT: 'old-shot', absent: undefined,
    })).toEqual({ Path: 'tools', TEMP: 'temporary' })
  })
  it('refuses installation on a persistent developer machine or self-hosted runner', () => {
    const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows' }
    expect(() =>{  requireHostedWindows('win32', environment) }).not.toThrow()
    expect(() =>{  requireHostedWindows('linux', environment) }).toThrow('disposable')
    for (const key of Object.keys(environment)) expect(() =>{  requireHostedWindows('win32', { ...environment, [key]: 'wrong' }) }).toThrow('disposable')
  })

  it('retains new evidence without overwriting earlier files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rc-output-'))
    roots.push(root)
    const receipt = await writeRcOutput(root, 'observation.json', { observed: true })
    expect(receipt).toEqual(await describeRcOutput(root, 'observation.json'))
    await expect(writeRcOutput(root, 'observation.json', { observed: false })).rejects.toThrow('EEXIST')
    await expect(writeRcOutput(root, '../outside.json', {})).rejects.toThrow('path')
    writeFileSync(join(root, 'observation.json'), 'different bytes')
    expect((await describeRcOutput(root, 'observation.json')).sha256).not.toBe(receipt.sha256)
  })

  it('requires a pinned scanner and complete installed npm coverage', () => {
    const registry: unknown = JSON.parse(readFileSync(join(repository, '.github/security/scanners.json'), 'utf8'))
    const input = {
      name: 'syft', version: '1.51.1', archiveSha256: '5e4bc3e6b6344b4625de0f7aa5351aaa72856d11d78462972de0a101ee2c1c8f',
      binarySha256: 'a'.repeat(64), catalogerSet: 'image',
      npmInventory: { manifestFiles: 5, versionedPackages: 3, unversionedNamedManifests: 1, npmComponents: 4,
        missingVersionedPackages: 0, missingNamedPackages: 0 },
    }
    expect(parseSyftReceipt(input, registry)).toEqual(input)
    for (const field of ['name', 'version', 'archiveSha256', 'binarySha256', 'catalogerSet']) {
      expect(() => parseSyftReceipt({ ...input, [field]: 'wrong' }, registry)).toThrow('Syft')
    }
    for (const [field, value] of [['versionedPackages', 0], ['missingVersionedPackages', 1], ['npmComponents', 2], ['manifestFiles', 1], ['npmComponents', NaN]]) {
      expect(() => parseSyftReceipt({ ...input, npmInventory: { ...input.npmInventory, [String(field)]: value } }, registry)).toThrow('Syft')
    }
    expect(parseSyftReceipt({ ...input, unrelated: 'must-not-retain' }, registry)).toEqual(input)
  })

  it('checks out the explicit candidate and runs real packaging, scanning and GUI acceptance before upload', () => {
    const workflow = load(readFileSync(join(repository, '.github/workflows/windows-candidate.yml'), 'utf8')) as {
      permissions: Record<string, string>
      jobs: { windows: {
        'runs-on': string
        defaults: { run: { shell: string } }
        env: Record<string, string>
        steps: Array<{
          uses?: string
          with?: Record<string, unknown>
          run?: string
          if?: string
          id?: string
        }>
      } }
    }
    expect(workflow.permissions).toEqual({ contents: 'read' })
    const job = workflow.jobs.windows
    expect(job['runs-on']).toBe('windows-2025')
    expect(job.defaults.run.shell).toBe('pwsh')
    expect(job.env.DSH_RC_SOURCE_SHA).toContain('github.event.pull_request.head.sha')
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with).toMatchObject({ ref: '${{ env.DSH_RC_SOURCE_SHA }}', 'persist-credentials': false })
    const commands = job.steps.map(step => step.run ?? '')
    const build = commands.findIndex(command => command.includes('pnpm run build:official'))
    const pack = commands.findIndex(command => command.includes('scripts/build-desktop-exe.ts'))
    const produce = commands.findIndex(command => command.includes('scripts/produce-windows-candidate.ts'))
    const upload = job.steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'))
    expect(build).toBeGreaterThan(-1)
    expect(pack).toBeGreaterThan(build)
    expect(produce).toBeGreaterThan(pack)
    expect(commands[produce]).toMatch(/^node --import tsx\/esm /)
    expect(job.steps[produce]?.id).toBe('acceptance')
    const diagnostic = job.steps.find(step => step.run?.includes('read-windows-installer-crash.ps1'))
    expect(diagnostic?.if).toBe("failure() && steps.acceptance.outcome == 'failure'")
    expect(diagnostic?.run).toContain('$env:RUNNER_TEMP/windows-rc/windows/installer.exe')
    expect(upload).toBeGreaterThan(produce)
    expect(job.steps[upload]?.if).toBeUndefined()
    expect(job.steps[upload]?.with).toMatchObject({ 'if-no-files-found': 'error', 'compression-level': 0 })
  })
})
