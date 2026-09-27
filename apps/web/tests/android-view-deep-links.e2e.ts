/** Android routes actual VIEW deliveries to trusted, persisted Session positions without replaying stale intents. */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { decodeSessionViewLocation, encodeSessionViewLocation } from '../../../packages/api/session-controller/src/client/view-location.ts'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const execute = promisify(execFile)
const LINK_PREFIX = 'dsh-companion://session-view/'
const APPLICATION = 'com.deepseek.harness.companion.nativeacceptance'

interface LinkSnapshot {
  phase: string
  arrival: number
  attempt: number
  issue: string | null
  incomingRejected: boolean
  sessionId: string | null
  anchor: number | null
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android opens trusted deep links once and preserves draft ownership across process recovery', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const restore: (() => void)[] = []
  const releases: (() => void)[] = []
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_DEEP_LINK', title: 'Native deep link', turns: 88 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-view-deep-link')
    const other = createChatScrollFixture({ markerPrefix: 'NATIVE_DEEP_LINK_OTHER', title: 'Original draft', turns: 4 })
    const otherId = await seedSession(scaffold, other.log, 'native-view-deep-link-other')
    const target = fixture.log.trim().split('\n').map(line => JSON.parse(line) as { type?: string; seq?: number; data?: unknown })
      .find(event => event.type === 'user/message' && JSON.stringify(event.data).includes(fixture.markers.user(2)))
    expect(target?.seq).toBeTypeOf('number')
    const anchor = SessionSeq(target!.seq!)
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const location = { hostId: host.hostId, sessionId, anchorSeq: anchor }
    const link = LINK_PREFIX + encodeSessionViewLocation(location)
    const adb = process.env.DSH_ANDROID_ADB!
    const serial = process.env.DSH_ANDROID_SERIAL ?? ''
    const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 30_000 })
    const start = (reset: boolean, startup?: string) => startAndroidCompanionUiDriver(adb, serial, info.port, reset, [], startup)
    const folder = fileURLToPath(new URL('../../../.artifacts/android-view-deep-links-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const screenshot = async (name: string) => {
      const result = await execute(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 30_000, encoding: 'buffer' })
      await writeFile(`${folder}/${name}.png`, result.stdout)
    }
    const unary: string[] = []
    let follows = 0
    let rejectPage = false
    let nextPage: { entered: () => void; release: Promise<undefined> } | undefined
    const holdPage = () => {
      let entered = false
      const release = Promise.withResolvers<undefined>()
      nextPage = { entered: () => { entered = true }, release: release.promise }
      releases.push(() => { release.resolve(undefined) })
      return { entered: () => entered, release: () => { release.resolve(undefined) } }
    }
    const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
    const invokeSpy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
      unary.push(`${request.namespace}/${request.method}`)
      if (request.namespace === 'session' && request.method === 'page') {
        if (rejectPage) { rejectPage = false; throw new RemoteError('gateway/internal', 'fixture deep-link page failure', {}) }
        const held = nextPage
        if (held) { nextPage = undefined; held.entered(); await held.release }
      }
      return invoke(request)
    })
    restore.push(() => { invokeSpy.mockRestore() })
    const stream = scaffold.ctx.typertGateway.stream.bind(scaffold.ctx.typertGateway)
    const streamSpy = vi.spyOn(scaffold.ctx.typertGateway, 'stream').mockImplementation((request) => {
      if (request.namespace === 'session' && request.method === 'follow') follows++
      return stream(request)
    })
    restore.push(() => { streamSpy.mockRestore() })
    driver = await start(true)
    await writeFile(`${folder}/installed-apks.json`, JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const response = await driver!.request(request)
      expect(response, `${stage}: ${JSON.stringify(response)}`).toMatchObject({ type: 'ok' })
      return response.value
    }
    const state = async () => await command({ op: 'viewLinkSnapshot' }) as LinkSnapshot
    const deliver = async (uri: string) => {
      if (!/^[A-Za-z0-9:/._?=-]+$/u.test(uri)) throw new Error('Unexpected test URI characters')
      const arrival = (await state()).arrival
      const result = await run('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW',
        '-c', 'android.intent.category.BROWSABLE', '-d', uri, '-p', APPLICATION)
      expect(result.stdout + result.stderr).not.toMatch(/Error:|unable to resolve/iu)
      await expect.poll(async () => (await state()).arrival, { timeout: 20_000 }).toBe(arrival + 1)
    }
    const draft = async () => command({ op: 'shareDraftSnapshot' })
    const opened = async () => command({ op: 'awaitViewLink', phase: 'OPENED', sessionId, anchor })
    const pages = () => unary.filter(method => method === 'session/page').length
    const issued = scaffold.ctx.deviceTrust.issuePairing('viewer')
    stage = 'pair-viewer-and-preserve-both-drafts'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'fillPromptDraft', text: 'Target-session unsent draft' })
    const targetDraft = await draft()
    await command({ op: 'openSession', sessionId: otherId })
    await command({ op: 'fillPromptDraft', text: 'Original-session unsent draft' })
    const originalDraft = await draft()

    stage = 'wrong-host-and-malformed-public-view-intents'
    const before = { follows, pages: pages() }
    await deliver(LINK_PREFIX + encodeSessionViewLocation({ ...location, hostId: 'another-host' as typeof host.hostId }))
    await command({ op: 'awaitViewLink', phase: 'FAILED' })
    expect((await state()).issue).toBe('WRONG_HOST')
    expect(await draft()).toEqual(originalDraft)
    expect({ follows, pages: pages() }).toEqual(before)
    await screenshot('wrong-host')
    await deliver(`${link}?extra=1`)
    await command({ op: 'awaitViewLink', phase: 'FAILED' })
    expect((await state()).issue).toBe('INVALID')
    expect({ follows, pages: pages() }).toEqual(before)
    await command({ op: 'dismissViewLink' })

    stage = 'pending-share-rejects-navigation-until-explicit-retry'
    await command({ op: 'deliverSharedText', text: 'Pending share stays a proposal' })
    const shared = await command({ op: 'shareIntakeSnapshot' })
    await deliver(link)
    await command({ op: 'awaitViewLink', phase: 'FAILED' })
    expect((await state()).issue).toBe('BUSY')
    expect(await command({ op: 'shareIntakeSnapshot' })).toEqual(shared)
    expect({ follows, pages: pages() }).toEqual(before)
    await command({ op: 'dismissSharedDraft' })
    expect((await state()).phase).toBe('FAILED')
    expect({ follows, pages: pages() }).toEqual(before)
    await command({ op: 'retryViewLink' })
    await opened()
    expect(await draft()).toEqual(targetDraft)
    expect(pages()).toBeGreaterThan(2)
    await screenshot('older-anchor')
    const copied = await command({ op: 'copyViewDeepLink' }) as string
    expect(copied.startsWith(LINK_PREFIX)).toBe(true)
    expect(decodeSessionViewLocation(copied.slice(LINK_PREFIX.length))).toEqual(location)

    stage = 'same-link-is-a-new-delivery'
    const previousArrival = (await state()).arrival
    await command({ op: 'scrollSessionToLatest' })
    await deliver(link)
    await opened()
    expect((await state()).arrival).toBe(previousArrival + 1)

    stage = 'history-failure-requires-manual-retry'
    rejectPage = true
    await deliver(link)
    await command({ op: 'awaitViewLink', phase: 'FAILED' })
    expect(rejectPage).toBe(false)
    expect(await draft()).toEqual(targetDraft)
    const failedPages = pages()
    expect((await state()).phase).toBe('FAILED')
    expect(pages()).toBe(failedPages)
    await command({ op: 'retryViewLink' })
    await opened()

    stage = 'opening-link-rejects-incoming-share'
    const held = holdPage()
    await deliver(link)
    await expect.poll(held.entered, { timeout: 20_000 }).toBe(true)
    await command({ op: 'awaitViewLink', phase: 'OPENING' })
    await run('shell', 'am', 'start', '-W', '-a', 'android.intent.action.SEND', '-t', 'text/plain',
      '--es', 'android.intent.extra.TEXT', 'rejected-during-navigation', '-p', APPLICATION)
    expect((await state()).incomingRejected).toBe(true)
    expect(await command({ op: 'shareIntakeSnapshot' })).toMatchObject({ phase: 'NONE', count: 0 })
    held.release()
    await opened()

    stage = 'process-death-does-not-replay-pending-link'
    const interrupted = holdPage()
    await deliver(link)
    await expect.poll(interrupted.entered, { timeout: 20_000 }).toBe(true)
    await command({ op: 'awaitViewLink', phase: 'OPENING' })
    const oldPid = await command({ op: 'inputCheckpoint' })
    await driver.kill(); driver = undefined
    interrupted.release()
    const pagesBeforeRestart = pages()
    driver = await start(false)
    expect(await command({ op: 'assertRestored' })).not.toBe(oldPid)
    await command({ op: 'openSession', sessionId })
    expect(await draft()).toEqual(targetDraft)
    expect((await state()).arrival).toBe(0)
    expect((await state()).anchor).toBeNull()
    expect(pages()).toBe(pagesBeforeRestart)
    await command({ op: 'openSession', sessionId: otherId })
    expect(await draft()).toEqual(originalDraft)
    await screenshot('restored-without-replay')

    stage = 'explicit-new-cold-view-launch'
    await driver.kill(); driver = undefined
    driver = await start(false, link)
    await command({ op: 'assertRestored' })
    await opened()
    expect((await state()).arrival).toBe(1)
    expect(await draft()).toEqual(targetDraft)
    await screenshot('cold-view-anchor')
    expect(unary.filter(method => ['session/prompt', 'session/create', 'session/handoff', 'fileUploads/upload', 'fileUploads/uploadImage'].includes(method))).toEqual([])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-view-deep-links.expected.md', import.meta.url)), [
      '# Android view-position deep links', '',
      '- Installed acceptance APK hashes match the current build artifacts.',
      '- Real public VIEW/BROWSABLE delivery resolves the application and a viewer can navigate the selected trusted Host without another confirmation.',
      '- Wrong-Host and malformed links open no Session follow or history request and preserve both drafts.',
      '- A pending Share proposal rejects link navigation; dismissing it cannot silently retry the rejected link.',
      '- Explicit retry reveals the old persistent anchor in an 88-turn Session and preserves the target draft.',
      '- The native copy action wraps the existing Web v1 payload; repeated new delivery of the same URI reveals the anchor again.',
      '- A failed history read requires explicit retry, and an opening link rejects a concurrent Share delivery.',
      '- Process death discards pending navigation authority; normal restart restores drafts without requesting the old anchor.',
      '- A genuinely new cold VIEW launch waits for the same trusted Host restoration and opens the requested anchor once.',
      '- Navigation submits no prompt, upload, Session creation or runtime migration and redeems no additional grant.',
      '- Evidence covers the tested emulator and native scheme, not physical devices, browser distribution, HTTPS App Links or other platform shells.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android deep-link stage', stage); failures.push(error) }
  finally {
    for (const release of releases) release()
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const dispose of restore.reverse()) dispose()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android view deep-link acceptance failed')
}, 300_000)
