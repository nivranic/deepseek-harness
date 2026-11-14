/** Saved Android Hosts keep download bytes and explicit continuation scoped to their own grants. */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const WINDOW_BYTES = 65_536
const INTERRUPTED_OFFSET = 2 * WINDOW_BYTES

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android isolates downloads for identical Session resources on saved Hosts', async () => {
  const options = {
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  }
  const a = await launchWebScaffold(options)
  let b: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const filename = `dsh-download-host-isolation-${randomUUID()}.bin`
  const reads = { a: [] as { path: string; offset: number; length: number }[], b: [] as { path: string; offset: number; length: number }[] }
  const pending = { a: 0, b: 0 }
  const mutations: string[] = []
  const restoreSpies: (() => void)[] = []
  let interruptA = true
  let stage = 'second-host'
  const previewsOnly = (calls: typeof reads.a) => {
    for (const call of calls) expect(call, stage).toEqual({ path: filename, offset: 0, length: 256 })
  }
  const ranges = (from: number, total: number) => Array.from({ length: (total - from) / WINDOW_BYTES }, (_, index) => ({
    path: filename, offset: from + index * WINDOW_BYTES, length: WINDOW_BYTES,
  }))
  try {
    b = await launchWebScaffold(options)
    const fixture = createChatScrollFixture({ markerPrefix: 'HOST_DOWNLOAD', title: 'Host downloads', turns: 1 })
    const sessionId = await seedSession(a, fixture.log, 'native-host-download-isolation')
    expect(await seedSession(b, fixture.log, sessionId)).toBe(sessionId)
    const bytesA = Buffer.alloc(9 * 1024 * 1024)
    const bytesB = Buffer.alloc(bytesA.length)
    for (let index = 0; index < bytesA.length; index++) {
      bytesA[index] = index % 251
      bytesB[index] = (index * 7 + 33) % 251
    }
    await writeFile(join(a.workspaceCwd, filename), bytesA)
    await writeFile(join(b.workspaceCwd, filename), bytesB)
    for (const [scaffold, host] of [[a, 'a'], [b, 'b']] as const) {
      const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
      const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
        pending[host]++
        try {
          if (['prompt', 'create', 'artifact', 'handoff', 'cancel', 'reply', 'write', 'writeBytes', 'rename', 'delete'].includes(request.method)) {
            mutations.push(`${host}:${request.namespace}/${request.method}`)
            throw new Error('Download acceptance cannot submit a Host mutation')
          }
          if (request.namespace === 'workspaceFiles' && request.method === 'readBytes') {
            const range = request.args.range as { offset: number; length: number }
            reads[host].push({ path: request.args.path as string, offset: range.offset, length: range.length })
            if (host === 'a' && interruptA && request.args.path === filename && range.length === WINDOW_BYTES && range.offset === INTERRUPTED_OFFSET) {
              interruptA = false
              throw new RemoteError('gateway/internal', 'fixture interrupted Host A download', {})
            }
          }
          return await invoke(request)
        } finally { pending[host]-- }
      })
      restoreSpies.push(() => { spy.mockRestore() })
    }
    const infoA = a.ctx.nativeRemote.describe()
    const infoB = b.ctx.nativeRemote.describe()
    const hostA = a.ctx.hostDescription.describe()
    const hostB = b.ctx.hostDescription.describe()
    expect(hostA.hostId).not.toBe(hostB.hostId)
    const payload = (scaffold: typeof a) => {
      const info = scaffold.ctx.nativeRemote.describe()
      const host = scaffold.ctx.hostDescription.describe()
      const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
      return {
        kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
        hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
        code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
      }
    }
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', infoA.port, true, [infoB.port])
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const folder = fileURLToPath(new URL('../../../.artifacts/android-download-host-isolation-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const capture = async (name: string) => {
      const screenshot = await command({ op: 'screenshot' })
      if (typeof screenshot !== 'string') throw new Error('Missing screenshot')
      await writeFile(join(folder, name), Buffer.from(screenshot, 'base64'))
    }
    stage = 'host-a-preview'
    await command({ op: 'pair', payload: payload(a) })
    await command({ op: 'assertCurrentHost', hostId: hostA.hostId, count: 1 })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'previewResource', path: filename })
    expect(await command({ op: 'assertResource', phase: 'PREVIEW' })).toMatchObject({ received: 256, prefix: bytesA.subarray(0, 256).toString('base64') })
    await command({ op: 'assertNoDownload' })
    previewsOnly(reads.a)
    expect(reads.b).toEqual([])
    stage = 'host-a-interrupted'
    const aStart = reads.a.length
    await command({ op: 'resumeDownload' })
    expect(await command({ op: 'assertDownload', phase: 'FAILED' })).toEqual({ phase: 'FAILED', received: INTERRUPTED_OFFSET, complete: false })
    await expect.poll(() => pending.a, { timeout: 5_000, message: 'Host A requests did not finish before switching Hosts' }).toBe(0)
    expect(reads.a.slice(aStart)).toEqual(ranges(0, INTERRUPTED_OFFSET + WINDOW_BYTES))
    const aInterrupted = reads.a.length
    await capture('host-a-interrupted.png')
    stage = 'host-b-without-download'
    await command({ op: 'repair', payload: payload(b) })
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 2 })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'previewResource', path: filename })
    expect(await command({ op: 'assertResource', phase: 'PREVIEW' })).toMatchObject({ received: 256, prefix: bytesB.subarray(0, 256).toString('base64') })
    await command({ op: 'assertNoDownload' })
    await capture('host-b-no-download.png')
    previewsOnly(reads.b)
    expect(reads.a).toHaveLength(aInterrupted)
    stage = 'host-b-explicit-download'
    const bStart = reads.b.length
    await command({ op: 'resumeDownload' })
    expect(await command({ op: 'assertDownload', phase: 'COMPLETE' })).toEqual({ phase: 'COMPLETE', received: bytesB.length, complete: true })
    expect(reads.b.slice(bStart)).toEqual(ranges(0, bytesB.length))
    expect(reads.a).toHaveLength(aInterrupted)
    await capture('host-b-complete.png')
    const bComplete = reads.b.length
    stage = 'host-a-restored-paused'
    await command({ op: 'selectHost', hostId: hostA.hostId })
    await command({ op: 'assertCurrentHost', hostId: hostA.hostId, count: 2 })
    const restoredNavigation = await command({ op: 'openSession', sessionId })
    await writeFile(join(folder, 'restored-navigation.json'), JSON.stringify(restoredNavigation, null, 2) + '\n')
    await command({ op: 'previewResource', path: filename })
    expect(await command({ op: 'assertResource', phase: 'PREVIEW' })).toMatchObject({ received: 256, prefix: bytesA.subarray(0, 256).toString('base64') })
    expect(await command({ op: 'assertDownload', phase: 'PAUSED' })).toEqual({ phase: 'PAUSED', received: INTERRUPTED_OFFSET, complete: false })
    await capture('host-a-paused.png')
    previewsOnly(reads.a.slice(aInterrupted))
    expect(reads.b).toHaveLength(bComplete)
    stage = 'host-a-explicit-continuation'
    const aResume = reads.a.length
    await command({ op: 'resumeDownload' })
    expect(await command({ op: 'assertDownload', phase: 'COMPLETE' })).toEqual({ phase: 'COMPLETE', received: bytesA.length, complete: true })
    expect(reads.a.slice(aResume)).toEqual(ranges(INTERRUPTED_OFFSET, bytesA.length))
    expect(reads.b).toHaveLength(bComplete)
    expect(mutations).toEqual([])
    expect(a.ctx.deviceTrust.listDevices()).toHaveLength(1)
    expect(b.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await capture('host-a-complete.png')
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-download-host-isolation.expected.md', import.meta.url)), [
      '# Android download Host isolation', '',
      '- Installed application and instrumentation APK hashes match their current build artifacts.',
      '- Two real Hosts expose different 9 MiB contents under the same Session id and relative file path.',
      '- Host A commits 128 KiB before temporary failure; its observed unary gateway invocations finish before switching.',
      '- Host B has no download controller or inherited progress; selection reads only its own 256-byte preview.',
      '- Explicit download on Host B starts at byte zero and completes every 64 KiB window, with no further workspace byte reads from Host A.',
      '- Returning to Host A restores exactly 128 KiB as PAUSED and reads only its own 256-byte preview.',
      '- Explicit continuation on Host A starts at byte 131072 and completes every missing window, with no further workspace byte reads from Host B.',
      '- Neither Host receives a prompt or business mutation; each retains exactly one device grant.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android download Host isolation stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const restore of restoreSpies) restore()
    await b?.close().catch((error: unknown) => { failures.push(error) })
    await a.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android download Host isolation acceptance failed')
}, 240_000)
