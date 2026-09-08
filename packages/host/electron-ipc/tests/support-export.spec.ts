/** Scanner admission, bounded output, cancellation, immutable bytes and atomic save behavior. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovedSupportDocument, supportScannerEnvironment } from '../src/support-export.ts'
import { POLICY, supportFixture } from './support-fixture.ts'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const value = await supportFixture()
  roots.push(value.root)
  return value
}
const signal = () => new AbortController().signal

describe('support-export admission', () => {
  it('freezes the snapshot before asynchronous work and saves exactly the admitted UTF-8 bytes', async () => {
    const f = await fixture()
    const snapshot = { complete: false, label: '诊断信息', nested: { count: 1 } }
    const preparing = ApprovedSupportDocument.prepare(f.runtime, f.directory, snapshot, POLICY, signal())
    snapshot.nested.count = 99
    const document = await preparing
    expect(await readdir(f.root)).toEqual(['SupportScanner'])
    const target = join(f.root, 'saved.json')
    await document.save(target, signal())
    const data = await readFile(target)
    expect(JSON.parse(data.toString('utf8'))).toEqual({ complete: false, label: '诊断信息', nested: { count: 1 }, scanner: f.identity })
    expect(document.bytes).toBe(data.length)
    expect(document.sha256).toBe(createHash('sha256').update(data).digest('hex'))
    expect(f.calls).toHaveLength(3)
    const input = f.calls[2]!.stdio.stdin
    expect(typeof input === 'object' && input.data).toBe(data.toString('utf8'))
    for (const handle of f.handles) {
      expect(handle.terminate).toHaveBeenCalledOnce()
      expect(handle.waitForExit).toHaveBeenCalledOnce()
    }
    expect((await readdir(f.root)).sort()).toEqual(['SupportScanner', 'saved.json'])
  })

  it('uses explicit default rules, ignores inline allow comments and creates no report or payload file', async () => {
    const f = await fixture()
    vi.stubEnv('HOME', 'ambient-home')
    vi.stubEnv('HTTPS_PROXY', 'ambient-proxy')
    vi.stubEnv('GITLEAKS_CONFIG', 'ambient-config')
    vi.stubEnv('GITLEAKS_CONFIG_TOML', 'ambient-rules')
    vi.stubEnv('EXAMPLE_TOKEN', 'ambient-credential')
    const env = supportScannerEnvironment()
    for (const key of ['HOME', 'HTTPS_PROXY', 'GITLEAKS_CONFIG', 'EXAMPLE_TOKEN']) expect(env[key]).toBeUndefined()
    expect(env.GITLEAKS_CONFIG_TOML).toBe('[extend]\nuseDefault = true\n')
    await ApprovedSupportDocument.prepare(f.runtime, f.directory, { complete: false }, POLICY, signal())
    expect(f.calls[1]!.argv).toEqual([
      f.executable, 'stdin', '--report-format', 'json', '--report-path', '-', '--redact=100',
      '--no-banner', '--no-color', '--log-level', 'fatal', '--ignore-gitleaks-allow',
      '--gitleaks-ignore-path', process.platform === 'win32' ? 'NUL' : '/dev/null',
    ])
    expect(f.calls.every(call => call.cwd === f.directory && call.env?.HOME === undefined)).toBe(true)
    expect(await readdir(f.root)).toEqual(['SupportScanner'])
  })

  it.each(['binary', 'license', 'manifest', 'extra', 'empty', 'directory'] as const)('rejects invalid bundled resources: %s', async (kind) => {
    const f = await fixture()
    if (kind === 'binary') await writeFile(f.executable, 'replaced')
    if (kind === 'license') await writeFile(join(f.directory, 'LICENSE'), 'replaced')
    if (kind === 'manifest') await writeFile(join(f.directory, 'scanner.json'), '{bad')
    if (kind === 'extra') await writeFile(join(f.directory, '.gitleaks.toml'), 'allow everything')
    if (kind === 'empty') await writeFile(join(f.directory, 'LICENSE'), '')
    if (kind === 'directory') {
      await unlink(join(f.directory, 'LICENSE'))
      await mkdir(join(f.directory, 'LICENSE'))
    }
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'invalid-scanner' })
    expect(f.calls).toHaveLength(0)
  })

  it('rejects a linked resource root, including a Windows junction', async () => {
    const f = await fixture()
    const linked = join(f.root, 'linked')
    await symlink(f.directory, linked, 'junction')
    try {
      await expect(ApprovedSupportDocument.prepare(f.runtime, linked, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'invalid-scanner' })
    } finally { await unlink(linked) }
  })

  it.each([
    ['version', 0, { output: '9.0.0' }, 'invalid-scanner'],
    ['missing canary', 1, { output: '[]', code: 0 }, 'invalid-scanner'],
    ['malformed report', 1, { output: '{}' }, 'scan-failed'],
    ['invalid JSON', 1, { output: '{' }, 'scan-failed'],
    ['invalid row', 1, { output: '[null]' }, 'scan-failed'],
    ['wrong exit code', 2, { code: 1, output: '[]' }, 'scan-failed'],
    ['signal', 2, { signal: 'SIGTERM' as const }, 'scan-failed'],
    ['truncated report', 2, { lossy: true }, 'scan-failed'],
    ['secret finding', 2, { code: 1, output: '[{"RuleID":"github-pat"}]' }, 'secrets-detected'],
    ['unjoined tree', 2, { join: () => Promise.resolve(false) }, 'cleanup-failed'],
  ] as const)('refuses %s before admitting a document', async (_name, index, step, reason) => {
    const f = await fixture()
    f.script((_spec, call) => call === index ? step : {})
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason })
    expect(await readdir(f.root)).toEqual(['SupportScanner'])
  })

  it('rejects a canary report that contains the unredacted test token', async () => {
    const f = await fixture()
    f.script((spec, index) => index === 1 ? { output: JSON.stringify([{ RuleID: 'github-pat', Secret: typeof spec.stdio.stdin === 'object' ? spec.stdio.stdin.data : '' }]) } : {})
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'invalid-scanner' })
  })

  it('rejects oversized final documents before spawning and rejects cancellation before collecting files', async () => {
    const f = await fixture()
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, { text: 'x'.repeat(40) }, { ...POLICY, maximumBytes: 10 }, signal())).rejects.toMatchObject({ reason: 'oversized' })
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, { ...POLICY, maximumBytes: 10 }, signal())).rejects.toMatchObject({ reason: 'oversized' })
    const aborted = AbortSignal.abort()
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, aborted)).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.calls).toHaveLength(0)
  })

  it.each(['cancel', 'deadline'] as const)('joins an interrupted scanner before reporting %s', async (reason) => {
    const f = await fixture()
    const controller = new AbortController()
    f.script(spec => ({ done: new Promise((resolve) => {
      spec.signal!.addEventListener('abort', () => { resolve({ exitCode: 0, signal: null }) }, { once: true })
      if (reason === 'cancel') controller.abort()
    }) }))
    const promise = ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, { ...POLICY, scanMilliseconds: 20 }, controller.signal)
    await expect(promise).rejects.toMatchObject(reason === 'cancel' ? { name: 'AbortError' } : { reason: 'timed-out' })
    expect(f.handles[0]!.waitForExit).toHaveBeenCalledOnce()
  })

  it('contains process-launch errors without admitting a document', async () => {
    const f = await fixture()
    f.script(() => { throw new Error('private native detail') })
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'scan-failed', message: 'scan-failed' })
  })

  it('joins a rejected process outcome and refuses a deadline that expires while joining', async () => {
    const failed = await fixture()
    failed.script(() => ({ done: Promise.reject(new Error('private bootstrap failure')) }))
    await expect(ApprovedSupportDocument.prepare(failed.runtime, failed.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'scan-failed' })
    expect(failed.handles[0]!.waitForExit).toHaveBeenCalledOnce()
    const slow = await fixture()
    slow.script(() => ({ join: () => new Promise((resolve) => { setTimeout(() => { resolve(true) }, 40) }) }))
    await expect(ApprovedSupportDocument.prepare(slow.runtime, slow.directory, {}, { ...POLICY, scanMilliseconds: 20 }, signal())).rejects.toMatchObject({ reason: 'timed-out' })
  })

  it('refuses a resource receipt changed while the final scanner runs', async () => {
    const f = await fixture()
    f.script((_spec, index) => index === 2 ? { done: writeFile(join(f.directory, 'scanner.json'), JSON.stringify({ ...f.identity, version: '8.30.2' })).then(() => ({ exitCode: 0, signal: null })) } : {})
    await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'invalid-scanner' })
  })

  it('uses POSIX executable and null-device arguments without forwarding ambient Windows or home configuration', async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'linux' } }))
    const f = await fixture()
    await ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())
    expect(f.calls[1]!.argv.at(-1)).toBe('/dev/null')
    expect(f.calls[1]!.argv[0]).toBe(join(f.directory, 'gitleaks'))
    expect(f.calls[1]!.env?.SystemRoot).toBeUndefined()
  })

  it('cleans a failed save and leaves an existing destination intact when cancelled', async () => {
    const f = await fixture()
    const document = await ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())
    const target = join(f.root, 'saved.json')
    await writeFile(target, 'existing')
    await expect(document.save(target, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readFile(target, 'utf8')).toBe('existing')
    await expect(document.save(f.directory, signal())).rejects.toMatchObject({ reason: 'save-failed' })
    expect((await readdir(f.root)).sort()).toEqual(['SupportScanner', 'saved.json'])
  })
})
