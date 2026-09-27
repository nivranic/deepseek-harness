/** Native retained history resumes after a test-owned logical follow interruption. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type { SessionFollowFrame, SessionFollowRequest } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
for (const recovery of ['covered', 'uncovered'] as const) {
  it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')(`Android resumes a ${recovery} retained Session cursor`, async () => {
    const scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
    })
    let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
    const failures: unknown[] = []
    const release = Promise.withResolvers<undefined>()
    const snapshots: Extract<SessionFollowFrame, { type: 'snapshot' }>[] = []
    const requests: SessionFollowRequest[] = []
    const mutations: string[] = []
    const stream = scaffold.ctx.typertGateway.stream.bind(scaffold.ctx.typertGateway)
    const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
    const followSpy = vi.spyOn(scaffold.ctx.typertGateway, 'stream').mockImplementation(async (request) => {
      if (request.namespace !== 'session' || request.method !== 'follow') return stream(request)
      requests.push(request.args.request as SessionFollowRequest)
      const first = requests.length === 1
      return (async function* () {
        for await (const frame of await stream(request)) {
          const snapshot = frame as SessionFollowFrame
          if (snapshot.type === 'snapshot') snapshots.push(snapshot)
          yield frame
          if (first) { await release.promise; return }
        }
      })()
    })
    const invokeSpy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation((request) => {
      if (['prompt', 'create', 'handoff', 'cancel', 'reply'].includes(request.method)) mutations.push(`${request.namespace}/${request.method}`)
      return invoke(request)
    })
    let stage = 'seed'
    try {
      const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_RESUME', title: 'Native cursor resume', turns: 88 })
      const sessionId = await seedSession(scaffold, fixture.log, `native-cursor-${recovery}`)
      await scaffold.ctx.sessionController.resolveAgent(sessionId)
      const session = scaffold.ctx.sessions.get(sessionId)
      if (session === undefined) throw new Error('native cursor fixture has no live Session')
      const info = scaffold.ctx.nativeRemote.describe()
      const host = scaffold.ctx.hostDescription.describe()
      driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
      const command = async (request: object) => {
        const result = await driver!.request(request)
        expect(result, `${stage}: ${JSON.stringify(result)}`).toMatchObject({ type: 'ok' })
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
      await command({ op: 'fillPromptDraft', text: 'Unsent during cursor recovery' })
      const first = await command({ op: 'loadOlderHistory' })
      expect(snapshots).toHaveLength(1)
      expect(requests[0]?.fromSeq).toBeUndefined()
      const cursor = snapshots[0]!.cursor
      stage = 'append-during-interruption'
      const count = recovery === 'covered' ? 3 : 60
      for (let index = 0; index < count; index++) {
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: `RESUMED_${index}` }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
      }
      await scaffold.ctx.sessions.flush(session)
      release.resolve(undefined)
      stage = 'resumed-window'
      await expect.poll(() => snapshots.length, { timeout: 20_000 }).toBe(2)
      expect(requests[1]?.fromSeq).toBe(cursor)
      const resumed = snapshots[1]!
      const resumedFirst = resumed.records[0]!.event.seq
      expect(resumed.records.length).toBe(recovery === 'covered' ? count : 50)
      if (recovery === 'covered') expect(resumedFirst).toBe(cursor + 1)
      else expect(resumedFirst).toBeGreaterThan(cursor + 1)
      await command({ op: 'assertSessionWindow', first: recovery === 'covered' ? first : resumedFirst, last: resumed.cursor, attempts: 2 })
      await command({ op: 'assertPromptDraft', text: 'Unsent during cursor recovery' })
      expect(mutations).toEqual([])
      expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
      const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-cursor-resume/', import.meta.url))
      await mkdir(folder, { recursive: true })
      await writeFile(`${folder}/${recovery}.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
      await command({ op: 'close' })
      expect(await driver.stop()).toBe(0)
      await compareOrRefreshGolden(fileURLToPath(new URL(`./expected/android-cursor-${recovery}.expected.md`, import.meta.url)), [
        `# Android ${recovery} cursor recovery`, '',
        '- A real Host serves an 88-turn seeded Session to the installed Android application.',
        '- Android loads older history and retains unsent input before the logical follow interruption.',
        '- The first request has no cursor; the reconnect request carries the last retained durable sequence.',
        recovery === 'covered'
          ? '- The Host returns only three new records; Android retains the older page and folds each sequence once.'
          : '- After sixty new messages, the Host returns its latest fifty-message window; Android drops the uncovered prefix without inventing a gap.',
        '- The final durable row is displayed; unsent input and the single device grant remain intact.',
        '- Recovery sends no prompt, creation, cancellation, reply, or runtime Handoff mutation.',
        '- This scenario qualifies a logical stream interruption, not physical network loss or foreground recovery.',
      ].join('\n'), MODE)
    } catch (error) { console.info('Android cursor recovery stage', stage, recovery); failures.push(error) }
    finally {
      release.resolve(undefined)
      await driver?.kill().catch((error: unknown) => { failures.push(error) })
      followSpy.mockRestore(); invokeSpy.mockRestore()
      await scaffold.close().catch((error: unknown) => { failures.push(error) })
    }
    if (failures.length) throw new AggregateError(failures, 'Android cursor recovery failed')
  }, 180_000)
}
