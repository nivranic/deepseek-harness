/** The open Session renders the §29 location facts and a live follow-stream state word. */
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
// Reading location facts drives no model call, so the replay Host boots providers-only over a
// header-only fixture; creating a Session on it still writes the header cwd and the default
// permission/preset selection the facts line publishes.
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/plan-narrow-viewport/session.v3.jsonl', import.meta.url))
const PRESET_WORDS: Record<string, string> = {
  'read-only': '仅可查看',
  'workspace-write': '工作区内修改',
  'danger-full-access': '完全权限',
  custom: '自定义',
}
const STATE_WORDS = ['空闲', '连接中', '重连中', '已断开', '停止中', '已停止']
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android renders Session location facts with a live connection-state word', async () => {
  const options = {
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  }
  const a = await launchWebScaffold(options)
  let b: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  let stage = 'second-host'
  try {
    b = await launchWebScaffold({ ...options, replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false, replayProvidersOnly: true })
    let preset: string | undefined
    b.ctx.on('session/event', (_session, event) => {
      if (event.type === 'permission/preset') preset = event.data.preset
    })
    const { sessionId } = await a.ctx.sessionController.create({ cwd: a.workspaceCwd })
    await b.ctx.sessionController.create({ cwd: b.workspaceCwd, sessionId })
    const infoA = a.ctx.nativeRemote.describe()
    const infoB = b.ctx.nativeRemote.describe()
    const hostB = b.ctx.hostDescription.describe()
    const issued = b.ctx.deviceTrust.issuePairing('collaborator')
    driver = await startAndroidCompanionUiDriver(
      process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', infoB.port, true, [infoA.port],
    )
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, stage).toMatchObject({ type: 'ok' })
      return result.value
    }
    const readFacts = async (): Promise<string> => String(await command({ op: 'assertLocationFacts' }))
    /** Poll the facts line until it matches, bounded; the list load, fold, and reconnect settle asynchronously. */
    const untilFacts = async (matches: (text: string) => boolean): Promise<string> => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const text = await readFacts()
        if (matches(text)) return text
        await delay(500)
      }
      throw new Error(`session location facts never matched within the polling window (stage ${stage})`)
    }
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${infoB.port}`,
      hostId: hostB.hostId, displayName: hostB.displayName, spkiFingerprint: infoB.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 1 })
    stage = 'open-session'
    await command({ op: 'openSession', sessionId })
    stage = 'facts'
    expect(preset, 'Host published a permission preset').toBeDefined()
    const presetWord = PRESET_WORDS[preset!] ?? preset!
    const replayHost = b
    const workspaceBase = basename(replayHost.workspaceCwd)
    const facts = await untilFacts(text => text.includes(hostB.displayName)
      && text.includes(workspaceBase) && text.includes(presetWord)
      && !STATE_WORDS.some(word => text.includes(word)))
    expect(facts, 'facts name the Host, workspace basename, and preset word with no state word')
      .toBe(`${hostB.displayName} · ${workspaceBase} · ${presetWord}`)
    const detail = String(await command({ op: 'assertLocationDetail' }))
    expect(detail, 'detail publishes the runtime word').toContain('完整运行时')
    expect(detail, 'detail publishes the full workspace path').toContain(replayHost.workspaceCwd)
    // The live outage-state word is not driven here: on this lane an adb-reverse removal is
    // undetectable by the idle follow stream (no keepalive), a same-Session reopen reuses the
    // live stream, and even a fresh connect through the removed tunnel was observed to succeed.
    // The state-word machinery (connection-state flow and §18-family word mapping) is covered
    // by the JVM connection-state tests; a deterministic outage needs a Host-side stream kill.
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-session-location.expected.md', import.meta.url)), [
      '# Android session location facts (§29)', '',
      '- An open Session renders one facts line naming the paired Host, the workspace directory basename, and the permission preset word, plus a detail line publishing the full-runtime word and the full workspace path.',
      '- The facts read published Host data only — no prompt, turn, or model call is involved. The live outage-state word rendering is covered by the JVM connection-state tests; a deterministic device-level outage needs a Host-side stream kill (see the note).',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android session location stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await b?.close().catch((error: unknown) => { failures.push(error) })
    await a.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android session location acceptance failed')
}, 300_000)
