/** Android reveals a Web view-location anchor through bounded real Host history pages. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
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
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android opens and copies a Web view location without migrating or submitting', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_LOCATION', title: 'Native view location', turns: 88 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-view-location')
    const target = fixture.log.trim().split('\n').map(line => JSON.parse(line) as { type?: string; seq?: number; data?: unknown })
      .find(event => event.type === 'user/message' && JSON.stringify(event.data).includes(fixture.markers.user(2)))
    expect(target?.seq).toBeTypeOf('number')
    const anchor = SessionSeq(target!.seq!)
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const location = { hostId: host.hostId, sessionId, anchorSeq: anchor }
    const encoded = encodeSessionViewLocation(location)
    let rejectPage = false
    const unary: string[] = []
    let streams = 0
    const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
    const stream = scaffold.ctx.typertGateway.stream.bind(scaffold.ctx.typertGateway)
    vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
      unary.push(`${request.namespace}/${request.method}`)
      if (request.namespace === 'session' && request.method === 'page' && rejectPage) {
        rejectPage = false
        throw new RemoteError('gateway/internal', 'fixture history read failure', {})
      }
      return invoke(request)
    })
    vi.spyOn(scaffold.ctx.typertGateway, 'stream').mockImplementation((request) => { streams++; return stream(request) })
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const command = async (request: object) => {
      const response = await driver!.request(request)
      expect(response, stage).toMatchObject({ type: 'ok' })
      return response.value
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'fillPromptDraft', text: 'Retain unsent text across a view jump' })
    stage = 'wrong-host'
    const before = streams
    await command({ op: 'rejectViewLocation', unchanged: true,
      payload: encodeSessionViewLocation({ ...location, hostId: 'another-host' as typeof host.hostId }),
    })
    expect(streams).toBe(before)
    expect(unary.filter(method => method === 'session/page')).toHaveLength(0)
    stage = 'failed-page'
    rejectPage = true
    await command({ op: 'rejectViewLocation', payload: encoded })
    expect(rejectPage).toBe(false)
    stage = 'explicit-retry'
    await command({ op: 'openViewLocation', payload: encoded, anchor })
    expect(unary.filter(method => method === 'session/page').length).toBeGreaterThan(2)
    await command({ op: 'assertPromptDraft', text: 'Retain unsent text across a view jump' })
    stage = 'repeat-same-anchor'
    await command({ op: 'scrollSessionToLatest' })
    await command({ op: 'openViewLocation', payload: encoded, anchor })
    stage = 'copy-back-to-web'
    const copied = await command({ op: 'copyViewLocation' })
    expect(decodeSessionViewLocation(copied as string)).toEqual(location)
    expect(unary.filter(method => ['session/prompt', 'session/create', 'session/handoff'].includes(method))).toEqual([])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-view-location/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(`${folder}/older-anchor.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-view-location.expected.md', import.meta.url)), [
      '# Android view-location Handoff', '',
      '- A real Host exposes an 88-turn seeded Session through the current native transport.',
      '- A Web-encoded location for another Host fails without opening a stream or history request.',
      '- A refused history page preserves input and requires explicit retry.',
      '- Retrying reveals the requested old event beyond the initial window using bounded message pages.',
      '- Reopening the same location after scrolling away reveals the anchor again.',
      '- Android copies the visible anchor in the same v1 grammar and the Web decoder recovers the original location.',
      '- Viewing and copying preserve unsent input, redeem no extra grant, and submit no prompt or runtime migration.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android view-location stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android view-location acceptance failed')
}, 180_000)
