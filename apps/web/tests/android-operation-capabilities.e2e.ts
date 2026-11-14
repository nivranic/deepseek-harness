/** Native actions follow negotiated API support while the real Host retains authorization. */
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
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android suppresses unsupported operations before dispatch and restores retained input', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: string[] = []
  const streams: string[] = []
  let refuseCancel = false
  const hidden = new Set(['session.control.v1', 'workspace.follow.v1', 'workspace-files.read-text.v1',
    'workspace-files.stat.v1', 'workspace-files.read-bytes.v1', 'subagent.catalog.v1'])
  const capabilities = scaffold.ctx.typertGateway.capabilities.bind(scaffold.ctx.typertGateway)
  // Methods remain installed: an accidental request can succeed, so absence is proved by dispatch observation.
  const capabilitySpy = vi.spyOn(scaffold.ctx.typertGateway, 'capabilities').mockImplementation(() => capabilities().filter(id => !hidden.has(id)))
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const unarySpy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    calls.push(endpoint)
    if (refuseCancel && endpoint === 'session/cancel') throw new RemoteError('gateway/permission-denied', 'fixture cancellation refusal', {
      endpoint, role: 'collaborator', required: 'prompt.send',
    })
    return invoke(request)
  })
  const stream = scaffold.ctx.typertGateway.stream.bind(scaffold.ctx.typertGateway)
  const streamSpy = vi.spyOn(scaffold.ctx.typertGateway, 'stream').mockImplementation(async (request) => {
    streams.push(`${request.namespace}/${request.method}`)
    return stream(request)
  })
  let stage = 'seed'
  try {
    expect(capabilities()).toEqual(expect.arrayContaining([...hidden, 'session.list.v1', 'session.follow.v1', 'workspace-files.list.v1']))
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_CAPABILITIES', title: 'Native capabilities', turns: 3 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-operation-capabilities')
    await scaffold.ctx.sessionController.resolveAgent(sessionId)
    await writeFile(join(scaffold.workspaceCwd, 'capability.txt'), 'Native capability fixture\n')
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const capture = async (name: string) => {
      const value = await command({ op: 'screenshot' })
      if (typeof value !== 'string') throw new Error('Native screenshot must be base64 text')
      const directory = fileURLToPath(new URL('../../../.artifacts/android-operation-capabilities-ui/', import.meta.url))
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, name), Buffer.from(value, 'base64'))
    }
    const refresh = async () => {
      await command({ op: 'capabilityDetails', state: 'available', refresh: true })
      await command({ op: 'closeCapabilityDetails' })
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    const draft = 'Preserved local draft 中文'
    await command({ op: 'fillPromptDraft', text: draft })
    stage = 'supported-list-without-controls'
    await command({ op: 'assertOperationVisibility', tab: 0, visible: { 'session-send': false, 'session-cancel': false, 'session-draft': true } })
    await capture('unsupported-controls.png')
    await command({ op: 'assertOperationVisibility', tab: 4, entry: 'capability.txt', visible: {
      'file-text-open-capability.txt': false, 'resource-open-capability.txt': false, 'file-entry-capability.txt': true,
    } })
    await command({ op: 'assertOperationVisibility', tab: 6, visible: { 'native-operation-unavailable': true } })
    const unsupported = ['session/prompt', 'session/cancel', 'workspaceFiles/read', 'workspaceFiles/stat', 'workspaceFiles/readBytes', 'subagents/list']
    expect(await command({ op: 'probeUnsupportedOperations', calls: unsupported, streams: ['workspace/follow'] }))
      .toEqual(Array.from({ length: 7 }, () => 'host/capability-unavailable'))
    expect(calls.filter(endpoint => unsupported.includes(endpoint))).toEqual([])
    expect(streams).not.toContain('workspace/follow')
    expect(calls).toContain('workspaceFiles/list')
    stage = 'withdraw-list-and-follow'
    const previousLists = calls.filter(endpoint => endpoint === 'session/list').length
    const previousFollows = streams.filter(endpoint => endpoint === 'session/follow').length
    hidden.add('session.list.v1'); hidden.add('session.follow.v1'); hidden.add('workspace-files.list.v1')
    await refresh()
    await command({ op: 'assertOperationVisibility', tab: 0, visible: { 'session-list-refresh': false, 'session-send': false, 'native-operation-unavailable': true } })
    await command({ op: 'assertStoredPromptDraft', sessionId, text: draft })
    expect(await command({ op: 'probeUnsupportedOperations', calls: ['session/list', 'session/page'], streams: ['session/follow'] }))
      .toEqual(Array.from({ length: 3 }, () => 'host/capability-unavailable'))
    expect(calls.filter(endpoint => endpoint === 'session/list')).toHaveLength(previousLists)
    expect(streams.filter(endpoint => endpoint === 'session/follow')).toHaveLength(previousFollows)
    stage = 'restore-advertisement'
    hidden.clear()
    await refresh()
    await command({ op: 'assertPromptDraft', text: draft })
    await command({ op: 'assertOperationVisibility', tab: 0, visible: { 'session-send': true, 'session-cancel': true } })
    await capture('restored-controls.png')
    await command({ op: 'assertOperationVisibility', tab: 4, entry: 'capability.txt', visible: {
      'file-text-open-capability.txt': true, 'resource-open-capability.txt': true,
    } })
    stage = 'permission-refusal-remains-host-owned'
    refuseCancel = true
    await command({ op: 'expectCancelRefusal' })
    await command({ op: 'assertPromptDraft', text: draft })
    expect(calls.filter(endpoint => ['session/prompt', 'session/cancel', 'session/create', 'session/handoff'].includes(endpoint)))
      .toEqual(['session/cancel'])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-operation-capabilities.expected.md', import.meta.url)), [
      '# Android operation capability admission', '',
      '- A real Host keeps its methods installed while its advertised capability subset changes.',
      '- Android lists Sessions and files independently of prompt control, workspace follow and file-read support.',
      '- Unsupported prompt, cancel, text, resource and subagent actions are absent from the UI.',
      '- Direct stale callers receive capability-unavailable before HTTP dispatch or mux subscription creation.',
      '- Withdrawing Session list/follow prevents new observations and preserves local draft identity and text.',
      '- A successful capability refresh restores actions and the selected Session draft without submitting it.',
      '- A Host cancellation refusal remains visible and does not crash the Activity or clear the draft.',
      '- This does not grant permissions or invent capability identifiers for the built-in event transport.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android operation capability stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    capabilitySpy.mockRestore(); unarySpy.mockRestore(); streamSpy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android operation capability acceptance failed')
}, 180_000)
