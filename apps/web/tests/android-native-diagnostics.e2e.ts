/** Installed Native Gateway diagnostics pass the bundled scanner without starting business work. */
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android exports scanned Native Gateway observations and retains facts after refusal', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const mutations: string[] = []
  let negotiations = 0
  let refuse = false
  let follows = 0
  const interrupt = Promise.withResolvers<undefined>()
  const stream = scaffold.ctx.typertGateway.stream.bind(scaffold.ctx.typertGateway)
  const followSpy = vi.spyOn(scaffold.ctx.typertGateway, 'stream').mockImplementation(async (request) => {
    if (request.namespace !== 'session' || request.method !== 'follow') return stream(request)
    const first = ++follows === 1
    return (async function* () {
      for await (const frame of await stream(request)) {
        yield frame
        if (first) {
          await interrupt.promise
          throw new RemoteError('gateway/host-not-ready', 'PRIVATE_REFUSAL_POISON', {})
        }
      }
    })()
  })
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    if (request.namespace === 'host' && request.method === 'negotiate') {
      negotiations++
      if (refuse) throw new RemoteError('gateway/permission-denied', 'PRIVATE_REFUSAL_POISON', {})
    }
    if (['prompt', 'create', 'handoff', 'cancel', 'reply'].includes(request.method)) mutations.push(`${request.namespace}/${request.method}`)
    return invoke(request)
  })
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_DIAGNOSTICS', title: 'PRIVATE_SESSION_POISON', turns: 3 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-diagnostics')
    await scaffold.ctx.sessionController.resolveAgent(sessionId)
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    const secrets = [issued.code, host.hostId, host.displayName, info.spkiFingerprint, sessionId,
      'PRIVATE_REFUSAL_POISON', 'PRIVATE_SESSION_POISON', 'https://127.0.0.1:']
    const document = async (refresh = false, minimumAttempts = 1) => {
      const value = await command({ op: 'supportDocument', refresh, minimumAttempts })
      // Keep the document on the private driver channel; failures report only a boolean, never its content.
      const text = JSON.stringify(value)
      expect(secrets.some(secret => text.includes(secret)), 'private fields are absent').toBe(false)
      expect(value).toMatchObject({ complete: false, transport: {
        producer: 'NativeGatewayClient', observation: 'current', activityScope: 'client-generation', closed: false,
      }, role: { producer: 'NativeGatewayClient.pairing', observation: 'last-known', value: 'collaborator' },
      protocol: { producer: 'NativeGatewayClient.describe', observation: 'last-known', apiProtocolVersion: 2, sessionFormatVersion: 3 },
      capabilities: { coverage: 'client-allowlist', supported: { 'session.follow.v1': true } }, scanner: { version: '8.30.1' } })
      return value
    }
    stage = 'scanned-current-observation'
    const before = negotiations
    expect(await document()).toMatchObject({ protocol: { queryState: 'available' },
      transport: { registeredMuxStreams: expect.any(Number) as unknown, startedHttpCalls: expect.any(Number) as unknown } })
    expect(negotiations).toBe(before)
    stage = 'refused-refresh'
    refuse = true
    expect(await document(true)).toMatchObject({ protocol: { queryState: 'failed', failure: 'refused' } })
    expect(negotiations).toBe(before + 1)
    stage = 'recovered-refresh'
    refuse = false
    const recovered = await document(true)
    expect(recovered).toMatchObject({ protocol: { queryState: 'available' } })
    expect(JSON.stringify(recovered)).not.toContain('"failure":"refused"')
    expect(negotiations).toBe(before + 2)
    stage = 'logical-follow-recovery'
    interrupt.resolve(undefined)
    expect(await document(false, 2)).toMatchObject({ connections: { sessionFollow: {
      producer: 'SessionModel', snapshot: { state: 'open', attempts: 2, interruptions: 1 },
    } } })
    expect(mutations).toEqual([])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-native-diagnostics.expected.md', import.meta.url)), [
      '# Android Native Gateway support diagnostics', '',
      '- A real Host serves a seeded Session to the installed isolated Android application.',
      '- The application exports its live model and Native Gateway observations through the bundled Gitleaks scanner.',
      '- HTTP callback ownership, mux subscription counts and pairing role have explicit Native Gateway producers.',
      '- API protocol 2 and durable Session format 3 remain independent observations.',
      '- A read-only negotiation refusal retains last-known facts with a fixed failure category; a successful refresh clears the failure.',
      '- Snapshot capture starts no negotiation; export sends no prompt, creation, cancellation, reply or Handoff mutation.',
      '- A test-owned logical follow failure and recovery appear in the separate SessionModel attempt and interruption counters.',
      '- Pairing codes, Host and Session identities, pins, addresses, labels and refusal text are absent.',
      '- This scenario does not qualify physical devices, crash collection, live-model behavior or release reproducibility.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android diagnostics stage', stage); failures.push(error) }
  finally {
    interrupt.resolve(undefined)
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    spy.mockRestore(); followSpy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android native diagnostics failed')
}, 180_000)
