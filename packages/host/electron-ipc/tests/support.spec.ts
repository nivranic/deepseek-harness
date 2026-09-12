/** Gateway ownership, privacy projection and native-export lifetime over the scanner admission path. */
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ConnectionDiagnosticSnapshot } from '@deepseek-ai/dsh-client-connection'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, DesktopSupport } from '../src/support.ts'
import { SupportExportError } from '../src/support-export.ts'
import type { DesktopSupportHost } from '../src/native.ts'
import { POLICY, supportFixture } from './support-fixture.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const files = await supportFixture()
  roots.push(files.root)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('subprocess', files.runtime as never)
  const support = new DesktopSupport(ctx, POLICY)
  const target = join(files.root, 'support.json')
  const manifest = { version: '0.1.2-alpha.1', dshProduct: { buildNumber: 1, channel: 'dev' } }
  const save = vi.fn<DesktopSupportHost['save']>(async (document, signal) => {
    await document.save(target, signal)
    return 'saved'
  })
  const host: DesktopSupportHost = {
    scannerDirectory: files.directory, readProductManifest: () => Promise.resolve(manifest), save,
    runtimeSnapshot: () => ({ phase: 'ready' }),
  }
  return { ...files, ctx, support, host, save, target, manifest }
}

describe('desktop support Gateway', () => {
  it.each([
    { phase: 'ready' }, { phase: 'failed', operation: 'startup' }, { phase: 'failed', operation: 'shutdown' },
  ] as const)('exports the native profile observation: %j', async (runtime) => {
    const f = await fixture()
    f.support.registerHost({ ...f.host, runtimeSnapshot: () => runtime })
    await expect(f.support.exportSupport()).resolves.toMatchObject({ status: 'saved' })
    const document = JSON.parse(await readFile(f.target, 'utf8')) as { runtime: unknown; uncollected: string[] }
    expect(document.runtime).toEqual({ producer: 'desktop-application', freshness: 'current', scope: 'profile-lifecycle', value: runtime })
    expect(document.uncollected).not.toContain('runtime-health')
  })

  it('copies native lifecycle fields before waiting for application metadata', async () => {
    const f = await fixture()
    const observed = Promise.withResolvers<undefined>()
    const metadata = Promise.withResolvers<typeof f.manifest>()
    const runtime = { phase: 'starting' } as const
    f.support.registerHost({ ...f.host, runtimeSnapshot: () => runtime, readProductManifest: () => {
      observed.resolve(undefined)
      return metadata.promise
    } })
    const exported = f.support.exportSupport()
    await observed.promise
    Object.assign(runtime, { phase: 'ready' })
    metadata.resolve(f.manifest)
    await expect(exported).resolves.toMatchObject({ status: 'saved' })
    const document = JSON.parse(await readFile(f.target, 'utf8')) as { runtime: { value: unknown } }
    expect(document.runtime.value).toEqual({ phase: 'starting' })
  })

  it('captures the requesting renderer observation before asynchronous collection', async () => {
    const f = await fixture()
    f.support.registerHost(f.host)
    const connection: ConnectionDiagnosticSnapshot = { state: 'opening', attempts: 1, interruptions: 0, countsSaturated: false }
    const exported = f.support.exportSupport(connection)
    Object.assign(connection, { state: 'connected', attempts: 2 })
    await expect(exported).resolves.toMatchObject({ status: 'saved' })
    const document = JSON.parse(await readFile(f.target, 'utf8')) as { connection: unknown; uncollected: string[] }
    expect(document.connection).toEqual({
      producer: 'client-connection', freshness: 'last-known', scope: 'requesting-renderer', activityScope: 'controller-lifetime',
      value: { state: 'opening', attempts: 1, interruptions: 0, countsSaturated: false },
    })
    expect(document.uncollected).not.toContain('connection')
  })

  it.each([
    { attempts: -1 }, { attempts: 0.5 }, { attempts: 0x1_0000_0000 }, { attempts: Number.NaN },
    { interruptions: 2 }, { countsSaturated: true }, { private: 'unapproved-field' },
  ])('refuses invalid renderer diagnostic fields before scanning: %j', async (change) => {
    const f = await fixture()
    f.support.registerHost(f.host)
    const connection: ConnectionDiagnosticSnapshot = { state: 'connected', attempts: 1, interruptions: 0, countsSaturated: false, ...change }
    await expect(f.support.exportSupport(connection)).resolves.toEqual({ status: 'failed', reason: 'invalid-diagnostics' })
    expect(f.calls).toHaveLength(0)
    expect(f.save).not.toHaveBeenCalled()
  })

  it('publishes only the export method and refuses calls until a native host registers', async () => {
    const f = await fixture()
    expect(remoteMethods(f.support)).toEqual([{ method: 'exportSupport', invocation: { kind: 'direct' }, exportName: 'export' }])
    expect(f.support.typertRemote.namespace).toBe('desktopSupport')
    await expect(f.support.exportSupport()).resolves.toEqual({ status: 'failed', reason: 'unavailable' })
    expect(f.calls).toHaveLength(0)
  })

  it('saves selected product fields and duplicate-safe event counts without Session payloads or identity', async () => {
    const f = await fixture()
    const privateText = 'fixture-private-prompt-and-credential'
    Object.assign(f.manifest, { password: privateText, description: privateText })
    f.support.registerHost(f.host)
    // Session payloads are intentionally present: the observer reads only the sequence and event type.
    const session = {} as Session
    for (const [seq, type] of ['turn/start', 'turn/end', 'tool/call', 'tool/result', 'assistant/message'].entries()) {
      const event = { seq, type, content: privateText, sessionId: privateText } as unknown as SessionEvent
      f.ctx.emit('session/event', session, event)
      f.ctx.emit('session/event', session, { ...event })
    }
    const result = await f.support.exportSupport()
    expect(result).toMatchObject({ status: 'saved', complete: false })
    const text = await readFile(f.target, 'utf8')
    expect(text).not.toContain(privateText)
    const value = JSON.parse(text) as Record<string, unknown>
    expect(value.product).toEqual({ producer: 'application-package', freshness: 'current',
      value: { version: '0.1.2-alpha.1', buildNumber: 1, channel: 'dev' } })
    expect(value.diagnostics).toMatchObject({ counts: { turnsStarted: 1, turnsEnded: 1, toolCalls: 1, toolResults: 1 } })
    expect(value.link).toMatchObject({ freshness: 'unavailable' })
    expect(value.uncollected).not.toContain('runtime-health')
    expect(value.uncollected).toContain('connection')
    expect(value.complete).toBe(false)
    expect(f.save).toHaveBeenCalledOnce()
  })

  it.each([
    undefined,
    { version: '0.1.2', dshProduct: { buildNumber: 0, channel: 'dev' } },
    { version: '01.2.3', dshProduct: { buildNumber: 1, channel: 'dev' } },
    { version: '65536.0.0', dshProduct: { buildNumber: 1, channel: 'dev' } },
    { version: '1.0.0+private', dshProduct: { buildNumber: 1, channel: 'dev' } },
    { version: '1.0.0-alpha', dshProduct: { buildNumber: 1, channel: 'stable' } },
    { version: '1.0.0', dshProduct: { buildNumber: 1, channel: 'canary' } },
    { version: '1.0.0-alpha', dshProduct: { buildNumber: 1, channel: 'beta' } },
  ])('rejects invalid staged metadata before scanner or native saving', async (manifest) => {
    const f = await fixture()
    f.support.registerHost({ ...f.host, readProductManifest: () => Promise.resolve(manifest) })
    await expect(f.support.exportSupport()).resolves.toEqual({ status: 'failed', reason: 'invalid-identity' })
    expect(f.calls).toHaveLength(0)
    expect(f.save).not.toHaveBeenCalled()
  })

  it('records a failed Link observation without exporting its raw error', async () => {
    const f = await fixture()
    f.ctx.provide('linkController', { diagnostics: async () => { throw new Error('private host path') } } as never)
    f.support.registerHost(f.host)
    await expect(f.support.exportSupport()).resolves.toMatchObject({ status: 'saved' })
    const text = await readFile(f.target, 'utf8')
    expect(text).not.toContain('private host path')
    expect((JSON.parse(text) as Record<string, unknown>).link).toEqual({ producer: 'link-access', freshness: 'failed' })
  })

  it('selects only advertised protocol and capability fields, keeping listener state separate from connection health', async () => {
    const f = await fixture()
    const protocol = {
      linkProtocolVersion: 1, contractVersion: 1, sessionFormatVersion: 0, runtimeClass: 'full', allowRemoteApproval: false,
      capabilities: {
        session: { list: true, history: true, follow: true, prompt: true, cancel: true },
        workspace: { follow: true }, interaction: { approval: false, question: false },
      },
    }
    f.ctx.provide('linkController', { diagnostics: () => Promise.resolve({ listenerState: 'listening', protocol }) } as never)
    f.support.registerHost(f.host)
    await expect(f.support.exportSupport()).resolves.toMatchObject({ status: 'saved' })
    const value = JSON.parse(await readFile(f.target, 'utf8')) as Record<string, unknown>
    expect(value.link).toEqual({ producer: 'link-access', freshness: 'current', value: { listenerState: 'listening', ...protocol } })
    expect(value.uncollected).toContain('connection')
    expect(value.uncollected).toContain('effective-role')
  })

  it('revokes admission immediately and joins native cancellation before disposal returns', async () => {
    const f = await fixture()
    const closed = Promise.withResolvers<'cancelled'>()
    const seen = Promise.withResolvers<AbortSignal>()
    const host = { ...f.host, save: vi.fn<DesktopSupportHost['save']>(async (_document, signal) => {
      seen.resolve(signal)
      return closed.promise
    }) }
    const unregister = f.support.registerHost(host)
    expect(() => f.support.registerHost(host)).toThrow('already has a native host')
    const exported = f.support.exportSupport()
    const nativeSignal = await seen.promise
    await expect(f.support.exportSupport()).resolves.toEqual({ status: 'busy' })
    let disposed = false
    const disposal = unregister().then(() => { disposed = true })
    expect(nativeSignal.aborted).toBe(true)
    await expect(f.support.exportSupport()).resolves.toEqual({ status: 'failed', reason: 'unavailable' })
    await Promise.resolve()
    expect(disposed).toBe(false)
    closed.resolve('cancelled')
    await expect(exported).resolves.toEqual({ status: 'cancelled' })
    await disposal
    expect(disposed).toBe(true)
    f.support.registerHost(f.host)
    await expect(f.support.exportSupport()).resolves.toMatchObject({ status: 'saved' })
  })

  it('never opens native saving when scanner admission fails', async () => {
    const f = await fixture()
    f.script(() => { throw new Error('private scanner detail') })
    f.support.registerHost(f.host)
    await expect(f.support.exportSupport()).resolves.toEqual({ status: 'failed', reason: 'scan-failed' })
    expect(f.save).not.toHaveBeenCalled()
  })

  it('contains failed metadata reads and cancellation of a pending scanner before native saving', async () => {
    const failed = await fixture()
    failed.support.registerHost({ ...failed.host, readProductManifest: async () => { throw new Error('private metadata path') } })
    await expect(failed.support.exportSupport()).resolves.toEqual({ status: 'failed', reason: 'scan-failed' })
    const pending = await fixture()
    const started = Promise.withResolvers<undefined>()
    pending.script(spec => ({ done: new Promise((resolve) => {
      started.resolve(undefined)
      spec.signal!.addEventListener('abort', () => { resolve({ exitCode: 0, signal: null }) }, { once: true })
    }) }))
    const unregister = pending.support.registerHost(pending.host)
    const exported = pending.support.exportSupport()
    await started.promise
    await unregister()
    await expect(exported).resolves.toEqual({ status: 'cancelled' })
    expect(pending.save).not.toHaveBeenCalled()
    expect(pending.handles[0]!.waitForExit).toHaveBeenCalledOnce()
  })

  it.each(['save-failed', 'cleanup-failed'] as const)('reports %s without claiming a saved file', async (reason) => {
    const f = await fixture()
    f.support.registerHost({ ...f.host, save: async () => { throw new SupportExportError(reason) } })
    await expect(f.support.exportSupport()).resolves.toEqual({ status: 'failed', reason })
  })

  it.each(['maximumBytes', 'maximumReportBytes', 'scanMilliseconds', 'shutdownMilliseconds'] as const)('rejects invalid %s during configuration', (key) => {
    expect(() => Config.parse({ [key]: 0 })).toThrow()
    expect(() => Config.parse({ [key]: Number.POSITIVE_INFINITY })).toThrow()
  })
})
