/** Installed persistent downloads resume fixed versions after process death and export complete disk bytes through SAF. */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
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
const execute = promisify(execFile)
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android resumes encrypted downloads and saves complete disk content', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: { endpoint: string; path: string | undefined; offset: number | undefined; length: number | undefined }[] = []
  const owned = new Set<string>()
  const prefix = `dsh-native-download-${randomUUID()}`
  const filename = `${prefix}-large.bin`
  const emptyName = `${prefix}-empty.bin`
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const adb = process.env.DSH_ANDROID_ADB!
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true })
  const destination = (name: string) => {
    if (!name.startsWith(`${prefix}-`) || !/^[a-z\d.-]+$/u.test(name)) throw new Error('Unexpected owned download filename')
    return `/sdcard/Download/${name}`
  }
  let refuseOffset: number | undefined = 131_072
  let holdOffset: number | undefined
  let heldReached = false
  let releaseHeld: () => void = () => {}
  const released = new Promise<void>((resolve) => { releaseHeld = resolve })
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const range = request.args.range as { offset: number; length: number } | undefined
    calls.push({ endpoint: `${request.namespace}/${request.method}`, path: request.args.path as string | undefined,
      offset: range?.offset, length: range?.length })
    if (request.namespace === 'workspaceFiles' && request.method === 'readBytes' && request.args.path === filename && range?.length === 65_536) {
      if (range.offset === refuseOffset) {
        refuseOffset = undefined
        throw new RemoteError('gateway/internal', 'fixture interrupted download', {})
      }
      if (range.offset === holdOffset) {
        holdOffset = undefined; heldReached = true; await released
        throw new RemoteError('gateway/internal', 'fixture process retired', {})
      }
    }
    return invoke(request)
  })
  const windows = () => calls.filter(call => call.path === filename && call.endpoint === 'workspaceFiles/readBytes' && call.length === 65_536)
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'PERSISTED_DOWNLOAD', title: 'Persistent downloads', turns: 1 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-persisted-downloads')
    const bytes = Buffer.alloc(9 * 1024 * 1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const digest = createHash('sha256').update(bytes).digest('hex')
    await writeFile(join(scaffold.workspaceCwd, filename), bytes)
    await writeFile(join(scaffold.workspaceCwd, emptyName), Buffer.alloc(0))
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(adb, serial, info.port)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const folder = fileURLToPath(new URL('../../../.artifacts/android-download-adoption-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const capture = async (name: string) => {
      const image = await command({ op: 'screenshot' })
      if (typeof image !== 'string') throw new Error('Missing screenshot')
      await writeFile(join(folder, name), Buffer.from(image, 'base64'))
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair'
    const originalPid = await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'previewResource', path: filename })
    await command({ op: 'assertResource', phase: 'PREVIEW' })
    expect(windows()).toHaveLength(0)
    stage = 'interrupted-download'
    await command({ op: 'resumeDownload' })
    expect(await command({ op: 'assertDownload', phase: 'FAILED' })).toMatchObject({ received: 131_072, complete: false })
    expect(windows().map(call => call.offset)).toEqual([0, 65_536, 131_072])
    await capture('interrupted.png')
    stage = 'active-process-death'
    holdOffset = 262_144
    await command({ op: 'resumeDownload' })
    await expect.poll(() => heldReached, { timeout: 20_000 }).toBe(true)
    expect(await command({ op: 'assertDownload', phase: 'DOWNLOADING' })).toMatchObject({ received: 262_144, complete: false })
    const beforeRestartReads = calls.length
    await driver.kill(); driver = undefined; releaseHeld()
    stage = 'restored-paused'
    driver = await startAndroidCompanionUiDriver(adb, serial, info.port, false)
    expect(await command({ op: 'assertRestored' })).not.toBe(originalPid)
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await command({ op: 'openSession', sessionId })
    const afterRestart = windows().length
    await command({ op: 'previewResource', path: filename })
    await command({ op: 'assertResource', phase: 'PREVIEW' })
    expect(await command({ op: 'assertDownload', phase: 'PAUSED' })).toMatchObject({ received: 262_144, complete: false })
    expect(windows()).toHaveLength(afterRestart)
    const restoredReads = calls.slice(beforeRestartReads).filter(call => call.path === filename && call.endpoint === 'workspaceFiles/readBytes')
    expect(restoredReads.map(call => ({ offset: call.offset, length: call.length }))).toEqual([{ offset: 0, length: 256 }])
    await capture('restored-paused.png')
    stage = 'complete-download'
    await command({ op: 'resumeDownload' })
    await expect.poll(async () => {
      const progress = await command({ op: 'downloadProgress' }) as { phase: string | null; received: number; complete: boolean }
      if (progress.phase === 'FAILED' || progress.phase === 'CHANGED' || progress.phase === 'UNAVAILABLE') {
        throw new Error(`Download stopped at ${progress.received} bytes with phase ${progress.phase}`)
      }
      return { received: progress.received, complete: progress.complete }
    }, { timeout: 90_000 }).toEqual({ received: bytes.length, complete: true })
    expect(await command({ op: 'assertDownload', phase: 'COMPLETE' })).toMatchObject({ received: bytes.length, complete: true })
    expect(windows()[afterRestart]?.offset).toBe(262_144)
    await capture('complete.png')
    stage = 'save-large-file'
    const beforeSave = calls.length
    const picker = await command({ op: 'openDownloadSave' }) as { filename: string; screenshot: string }
    expect(picker.filename).toBe(filename)
    await writeFile(join(folder, 'picker.png'), Buffer.from(picker.screenshot, 'base64'))
    owned.add(filename)
    await command({ op: 'finishResourceSave', filename })
    expect((await run('shell', 'sha256sum', destination(filename))).stdout.split(/\s+/u)[0]).toBe(digest)
    expect(calls.slice(beforeSave).filter(call => call.endpoint.startsWith('workspaceFiles/'))).toEqual([])
    await capture('saved.png')
    stage = 'changed-version'
    await command({ op: 'removeDownload' })
    refuseOffset = 65_536
    await command({ op: 'resumeDownload' })
    expect(await command({ op: 'assertDownload', phase: 'FAILED' })).toMatchObject({ received: 65_536 })
    await writeFile(join(scaffold.workspaceCwd, filename), Buffer.from('replacement'))
    const beforeChanged = calls.length
    await command({ op: 'resumeDownload' })
    expect(await command({ op: 'assertDownload', phase: 'CHANGED' })).toMatchObject({ received: 65_536, complete: false })
    expect(calls.slice(beforeChanged).filter(call => call.path === filename && call.endpoint === 'workspaceFiles/readBytes')).toEqual([])
    await capture('changed.png')
    await command({ op: 'removeDownload' })
    expect((await run('shell', 'sha256sum', destination(filename))).stdout.split(/\s+/u)[0]).toBe(digest)
    stage = 'empty-download'
    await command({ op: 'closeResource' })
    await command({ op: 'previewResource', path: emptyName })
    await command({ op: 'assertResource', phase: 'READY' })
    await command({ op: 'resumeDownload' })
    expect(await command({ op: 'assertDownload', phase: 'COMPLETE' })).toMatchObject({ received: 0, complete: true })
    await command({ op: 'openDownloadSave' })
    owned.add(emptyName)
    await command({ op: 'finishResourceSave', filename: emptyName })
    expect((await run('shell', 'sha256sum', destination(emptyName))).stdout.split(/\s+/u)[0]).toBe(createHash('sha256').update(Buffer.alloc(0)).digest('hex'))
    expect(calls.filter(call => ['prompt', 'cancel', 'create', 'handoff', 'reply'].includes(call.endpoint.split('/')[1]!))).toEqual([])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-download-adoption.expected.md', import.meta.url)), [
      '# Android persistent downloads', '',
      '- Installed application and instrumentation APK hashes match their current build artifacts.',
      '- A 9 MiB resource remains a bounded preview while its complete download is encrypted on disk.',
      '- Temporary failure retains the committed prefix; an active download survives process death as paused progress.',
      '- Restoration performs no automatic download; explicit continuation starts at the first missing byte.',
      '- The real system picker saves complete large and empty files; independent destination SHA-256 matches Host bytes.',
      '- Saving the completed download sends no further Host file read.',
      '- Changed versions cannot append; explicit local removal leaves the Host and exported document unchanged.',
      '- No Host prompt or business mutation is submitted.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android download stage', stage); failures.push(error) }
  finally {
    releaseHeld()
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const name of owned) await run('shell', 'rm', '-f', '--', destination(name)).catch((error: unknown) => { failures.push(error) })
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android download acceptance failed')
}, 240_000)
