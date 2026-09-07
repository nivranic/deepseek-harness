/** The Apple archive producer rejects unsupported hosts and preserves archive file identity. */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { chmod, link, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { inventoryAppleArchive } from './release/apple-archive-files.ts'
import { inspectWorkflowSecurity } from './workflow-security.ts'

const repository = resolve(import.meta.dirname, '..')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-apple-archives-'))
  roots.push(root)
  return root
}

describe('Apple archive file inventory', () => {
  it('detects changed bytes and retained executable permissions', async () => {
    const root = temporary()
    await mkdir(join(root, 'Contents'))
    await writeFile(join(root, 'Contents/app'), 'executable')
    if (process.platform !== 'win32') await chmod(join(root, 'Contents/app'), 0o755)
    const first = await inventoryAppleArchive(root)
    expect(first[1]).toMatchObject({ path: 'Contents/app', kind: 'file', bytes: 10 })
    if (process.platform !== 'win32') expect(first[1]!.mode).toBe(0o755)
    await writeFile(join(root, 'Contents/app'), 'Executable')
    expect((await inventoryAppleArchive(root))[1]!.sha256).not.toBe(first[1]!.sha256)
  })
  it.each(['embedded.mobileprovision', 'embedded.provisionprofile'])('rejects %s', async (profile) => {
    const root = temporary()
    await writeFile(join(root, profile), 'synthetic profile')
    await expect(inventoryAppleArchive(root)).rejects.toThrow('provisioning profiles')
  })
  it('rejects multiply linked artifact bytes', async () => {
    const root = temporary()
    await writeFile(join(root, 'original'), 'bytes')
    await link(join(root, 'original'), join(root, 'alias'))
    await expect(inventoryAppleArchive(root)).rejects.toThrow('without links')
  })
  it.runIf(process.platform !== 'win32')('retains internal framework links and refuses external or linked roots', async () => {
    const root = temporary(), outside = temporary()
    await mkdir(join(root, 'Versions/A'), { recursive: true })
    await writeFile(join(root, 'Versions/A/Framework'), 'binary')
    await symlink('A', join(root, 'Versions/Current'))
    await symlink('Versions/Current/Framework', join(root, 'Framework'))
    const files = await inventoryAppleArchive(root)
    expect(files.filter(file => file.kind === 'symlink')).toEqual([
      { path: 'Framework', kind: 'symlink', target: 'Versions/Current/Framework' },
      { path: 'Versions/Current', kind: 'symlink', target: 'A' },
    ])
    await symlink(root, join(outside, 'root'))
    await expect(inventoryAppleArchive(join(outside, 'root'))).rejects.toThrow('real directory')
    await symlink(outside, join(root, 'external'))
    await expect(inventoryAppleArchive(root)).rejects.toThrow('leaves its owned directory')
  })
})

describe('Apple archive producer workflow', () => {
  it.runIf(process.platform !== 'darwin')('loads through tsx and rejects a non-macOS host before writing', async () => {
    const output = join(temporary(), 'output')
    await expect(promisify(execFile)(process.execPath, ['--import', 'tsx/esm', 'scripts/produce-apple-archives.ts', '--output', output],
      { cwd: repository, windowsHide: true })).rejects.toMatchObject({ code: 1,
      stderr: expect.stringContaining('require macOS and Xcode') as unknown })
    expect(existsSync(output)).toBe(false)
  }, 30_000)
  it('uses immutable checkout, read-only permissions and successful archive upload', () => {
    const workflow = load(readFileSync(join(repository, '.github/workflows/apple-archives.yml'), 'utf8')) as {
      permissions: Record<string, string>
      jobs: { archives: { 'runs-on': string; steps: Array<{ name?: string; uses?: string; if?: string; with?: Record<string, unknown> }> } }
    }
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.archives['runs-on']).toBe('macos-15')
    expect(workflow.jobs.archives.steps.find(step => step.uses?.startsWith('actions/checkout@'))!.with).toEqual({
      ref: '${{ env.DSH_RC_SOURCE_SHA }}', 'persist-credentials': false,
    })
    expect(workflow.jobs.archives.steps.find(step => step.name === 'Preserve verified Companion archives')!.if).toBeUndefined()
    const directory = join(repository, '.github/workflows')
    const files = new Map(readdirSync(directory).filter(name => /\.ya?ml$/.test(name)).map(name => [name, readFileSync(join(directory, name), 'utf8')]))
    expect(inspectWorkflowSecurity(files,
      JSON.parse(readFileSync(join(repository, 'release/action-pins.json'), 'utf8')) as unknown,
      JSON.parse(readFileSync(join(repository, 'release/workflow-security.json'), 'utf8')) as unknown)).toEqual([])
  })
})
