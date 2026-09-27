/** Android replaces an invalid Host receipt only through explicit discard, selection and sending. */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-query'
import type { FileUploadValue } from '@deepseek-ai/dsh-client-file-upload'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const execute = promisify(execFile)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface Draft {
  text: string
  requestId: string
  attachments: { type: string; receiptId: string; attachmentId: string; name: string; bytes: number }[]
}
interface InputSnapshot {
  pid: number
  hostId: string
  hostKey: string
  generation: number
  sessionOwner: number
  input: { drafts: Record<string, Draft>; pending: Record<string, { sessionId: string; draft: Draft }>; lastSessionId: string | null }
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android explicitly replaces a file receipt invalidated by real Session disposal', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  const ctx = scaffold.ctx
  const sessionId = SessionId(`native-receipt-${randomUUID()}`)
  const failures: unknown[] = []
  const events: SessionEvent[] = []
  const disposed: Session[] = []
  const uploads: FileUploadValue[] = []
  const prompts: unknown[] = []
  const refusals: { code: string; details: unknown }[] = []
  const calls: string[] = []
  let inFlight = 0
  let activeFollows = 0
  let handle: AgentHandle | undefined
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  let ownsDeviceFile = false
  const filename = `dsh-native-receipt-${randomUUID()}-data.bin`
  const bytes = Buffer.from([0, 255, 13, 10, 128, 42, 1, 0])
  const deviceFile = `/sdcard/Download/${filename}`
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 30_000 })
  const stopEvents = ctx.on('session/event', (session, event) => { if (session.id === sessionId) events.push(event) })
  const stopDisposed = ctx.on('session/disposed', (session) => { if (session.id === sessionId) disposed.push(session) })
  const invoke = ctx.typertGateway.invoke.bind(ctx.typertGateway)
  const invokeSpy = vi.spyOn(ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    const observed = endpoint === 'fileUploads/upload' || endpoint === 'session/prompt'
    if (observed) { calls.push(endpoint); inFlight++ }
    if (endpoint === 'session/prompt') prompts.push(structuredClone(request.args.request))
    try {
      const result = await invoke(request)
      if (endpoint === 'fileUploads/upload') uploads.push(result as FileUploadValue)
      return result
    } catch (error) {
      const refusal = remoteErrorOf(error)
      if (endpoint === 'session/prompt' && refusal) refusals.push({ code: refusal.code, details: refusal.details })
      throw error
    } finally { if (observed) inFlight-- }
  })
  const stream = ctx.typertGateway.stream.bind(ctx.typertGateway)
  const streamSpy = vi.spyOn(ctx.typertGateway, 'stream').mockImplementation(async (request) => {
    if (request.namespace !== 'session' || request.method !== 'follow') return stream(request)
    return (async function* () {
      activeFollows++
      try { yield* await stream(request) }
      finally { activeFollows-- }
    })()
  })
  let stage = 'create-owned-session'
  try {
    const folder = fileURLToPath(new URL('../../../.artifacts/android-attachment-receipt-recovery-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const localFile = join(folder, filename)
    await writeFile(localFile, bytes)
    ownsDeviceFile = true
    await run('push', localFile, deviceFile)
    const preset = await ctx.agentPresets.resolve(undefined)
    const { provider, model } = ctx.agentDefaultModel.currentSelection()
    handle = await ctx.agents.create({
      sessionId, meta: { cwd: scaffold.workspaceCwd, agentPreset: preset.id }, agentOptions: { provider, model },
      setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset.id) },
    })
    const oldAgent = handle.agent
    const oldSession = oldAgent.session
    const route = await ctx.sessionController.resolveAgent(sessionId)
    expect('agent' in route && route.agent).toBe(oldAgent)
    const native = ctx.nativeRemote.describe()
    const host = ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(adb, serial, native.port)
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, `${stage}: ${JSON.stringify(result)}`).toMatchObject({ type: 'ok' })
      return result.value
    }
    const snapshot = async () => await command({ op: 'foregroundSnapshot' }) as InputSnapshot
    const capture = async (name: string) => {
      await command({ op: 'hidePromptKeyboard' })
      await writeFile(join(folder, name), Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
    }
    const pick = async () => {
      await command({ op: 'openAttachmentPicker' })
      await command({ op: 'finishAttachmentPick', filename })
      await command({ op: 'assertAttachments', files: [{ name: filename, bytes: bytes.length }] })
      await command({ op: 'awaitAttachmentReady' })
      await expect.poll(() => inFlight, { timeout: 20_000 }).toBe(0)
    }
    const issued = ctx.deviceTrust.issuePairing('collaborator')
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${native.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: native.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    const originalText = 'Original attachment intent before Session disposal'
    const newerText = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    expect(newerText).not.toBe(originalText)
    await command({ op: 'fillPromptDraft', text: originalText })
    stage = 'first-real-saf-upload'
    await pick()
    expect(uploads).toHaveLength(1)
    const original = await snapshot()
    const draftA = original.input.drafts[sessionId]!
    expect(draftA.text).toBe(originalText)
    expect(ctx.fileUploads.resolve(oldAgent, uploads[0]!.receiptId)).toEqual(uploads[0]!.file)
    expect(draftA.attachments.map(file => file.receiptId)).toEqual([uploads[0]!.receiptId])
    expect(digest(await readFile(ctx.attachments.fileHostPath(uploads[0]!.file)!))).toBe(digest(bytes))
    expect(calls).toEqual(['fileUploads/upload'])
    await expect.poll(() => activeFollows, { timeout: 20_000 }).toBe(1)

    stage = 'real-session-disposal-and-resume'
    await command({ op: 'returnToSessionList' })
    await expect.poll(() => activeFollows, { timeout: 20_000 }).toBe(0)
    expect(inFlight).toBe(0)
    expect((await snapshot()).input.lastSessionId).toBeNull()
    await oldAgent.whenIdle()
    expect(await ctx.sessions.flush(oldSession)).toBe(true)
    await handle.dispose()
    handle = undefined
    expect(disposed).toEqual([oldSession])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    {
      using observation = await ctx.sessionQuery.observeSession(sessionId)
      expect(observation.header).toMatchObject({ id: sessionId, cwd: scaffold.workspaceCwd, agentPreset: preset.id })
    }
    const resumed = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resumed) throw resumed.error
    expect(resumed.agent).not.toBe(oldAgent)
    expect(resumed.agent.session).not.toBe(oldSession)
    expect(resumed.agent.session.header).toMatchObject({ id: sessionId, cwd: scaffold.workspaceCwd, agentPreset: preset.id })
    expect(ctx.fileUploads.resolve(resumed.agent, uploads[0]!.receiptId)).toBeUndefined()
    expect(ctx.hostDescription.describe().hostId).toBe(host.hostId)
    expect(ctx.nativeRemote.describe()).toEqual(native)
    await command({ op: 'openSession', sessionId })
    expect((await snapshot()).input.drafts[sessionId]).toEqual(draftA)
    expect(calls).toEqual(['fileUploads/upload'])
    const beforeRefusal = resumed.agent.session.snapshotEvents()

    stage = 'real-receipt-refusal'
    await command({ op: 'failPromptDraft', text: originalText })
    const refusal = { code: 'session/attachment-invalid', reason: 'FILE_NOT_STAGED' }
    expect(await command({ op: 'assertAttachmentReceiptRefusal' })).toEqual(refusal)
    expect(refusals).toEqual([{ code: refusal.code, details: { reason: refusal.reason } }])
    const rejected = await snapshot()
    expect(rejected.input.pending[draftA.requestId]).toEqual({ sessionId, draft: draftA })
    expect(rejected.input.drafts[sessionId]).toEqual(draftA)
    expect(resumed.agent.session.snapshotEvents()).toEqual(beforeRefusal)
    await command({ op: 'assertPendingPromptVisible', requestId: draftA.requestId })
    await capture('invalid-receipt.png')

    stage = 'new-draft-and-original-pending-retry'
    await command({ op: 'replacePromptDraft', text: newerText })
    const draftB = (await snapshot()).input.drafts[sessionId]!
    expect(draftB).toMatchObject({ text: newerText, attachments: draftA.attachments })
    expect(draftB.requestId).not.toBe(draftA.requestId)
    await command({ op: 'hidePromptKeyboard' })
    await command({ op: 'assertPendingPromptVisible', requestId: draftA.requestId })
    await capture('new-draft-and-pending.png')
    expect(await command({ op: 'retryRejectedAttachmentPrompt', requestId: draftA.requestId })).toEqual(refusal)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toEqual(prompts[0])
    expect(prompts[0]).toMatchObject({ sessionId, requestId: draftA.requestId, content: [
      { type: 'text', text: originalText }, { type: 'file', receiptId: uploads[0]!.receiptId },
    ] })
    expect(refusals).toHaveLength(2)
    expect(refusals[1]).toEqual(refusals[0])
    const retried = await snapshot()
    expect(retried.input.pending).toEqual(rejected.input.pending)
    expect(retried.input.drafts[sessionId]).toEqual(draftB)
    expect(resumed.agent.session.snapshotEvents()).toEqual(beforeRefusal)

    stage = 'explicit-discard-remove-and-reselect'
    await command({ op: 'discardPendingPrompt', requestId: draftA.requestId })
    const discarded = await snapshot()
    expect(discarded.input.pending).toEqual({})
    expect(discarded.input.drafts[sessionId]).toEqual(draftB)
    await command({ op: 'removeAttachment', receiptId: uploads[0]!.receiptId })
    const draftC = (await snapshot()).input.drafts[sessionId]!
    expect(draftC).toMatchObject({ text: newerText, attachments: [] })
    expect(draftC.requestId).not.toBe(draftB.requestId)
    expect(calls).toEqual(['fileUploads/upload', 'session/prompt', 'session/prompt'])
    await pick()
    expect(uploads).toHaveLength(2)
    expect(uploads[1]!.receiptId).not.toBe(uploads[0]!.receiptId)
    expect(ctx.fileUploads.resolve(resumed.agent, uploads[1]!.receiptId)).toEqual(uploads[1]!.file)
    expect(digest(await readFile(ctx.attachments.fileHostPath(uploads[1]!.file)!))).toBe(digest(bytes))
    const draftD = (await snapshot()).input.drafts[sessionId]!
    expect(draftD).toMatchObject({ text: newerText, attachments: [{ receiptId: uploads[1]!.receiptId }] })
    expect(draftD.requestId).not.toBe(draftC.requestId)
    expect(draftD.requestId).not.toBe(draftA.requestId)
    expect(new Set([draftA.requestId, draftB.requestId, draftC.requestId, draftD.requestId]).size).toBe(4)
    await capture('replacement-ready.png')

    stage = 'explicit-new-intent-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => events.some(event => event.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    await command({ op: 'assertAttachments', files: [] })
    await expect.poll(() => inFlight, { timeout: 20_000 }).toBe(0)
    expect(calls).toEqual(['fileUploads/upload', 'session/prompt', 'session/prompt', 'fileUploads/upload', 'session/prompt'])
    expect(prompts[2]).toMatchObject({ sessionId, requestId: draftD.requestId, content: [
      { type: 'text', text: newerText }, { type: 'file', receiptId: uploads[1]!.receiptId },
    ] })
    expect(refusals).toHaveLength(2)
    const messages = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    expect(messages).toHaveLength(1)
    const message = messages[0]!
    if (message.type !== 'user/message') throw new Error('Missing accepted attachment message')
    expect(message.data.source).toMatchObject({ kind: 'user', rpcId: draftD.requestId })
    expect(message.data.content).toEqual([{ type: 'text', text: newerText }, { type: 'file', attachment: uploads[1]!.file }])
    const final = await snapshot()
    expect(final.input.drafts[sessionId]).toBeUndefined()
    for (const key of ['pid', 'hostId', 'hostKey', 'generation', 'sessionOwner'] as const) expect(final[key]).toBe(original[key])
    expect(ctx.deviceTrust.listDevices()).toHaveLength(1)
    await command({ op: 'assertAttachmentMessage', seq: message.seq, names: [filename] })
    await capture('sent-replacement.png')
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await expect.poll(() => activeFollows, { timeout: 20_000 }).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-attachment-receipt-recovery.expected.md', import.meta.url)), [
      '# Android attachment receipt recovery', '',
      '- A real SAF upload is verified against Host storage before the owning Session is flushed, disposed and resumed.',
      '- The same Host and durable Session id retain distinct live Session objects; the old receipt is no longer authorized.',
      '- Explicit sending receives session/attachment-invalid with FILE_NOT_STAGED and displays local recovery guidance.',
      '- The rejected pending intent retains its original text, attachment and request id while a different newer draft survives.',
      '- Retrying the pending intent sends its unchanged arguments and receives the same real refusal without a durable user message.',
      '- Explicit discard preserves the newer draft; removing and reselecting its attachment creates a new receipt and request identity.',
      '- Two uploads and three prompt calls produce exactly one accepted user message, only after the final explicit send.',
      '- The application PID, Host identity, local Session model and single device grant remain unchanged; normal teardown completes.',
      '- This case qualifies Session-disposal receipt invalidation for SAF files, not a time expiry, Host restart or photo recovery.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android attachment receipt recovery stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await expect.poll(() => inFlight + activeFollows, { timeout: 20_000 }).toBe(0).catch((error: unknown) => { failures.push(error) })
    if (ownsDeviceFile) await run('shell', 'rm', '-f', '--', deviceFile).catch((error: unknown) => { failures.push(error) })
    if (handle) await handle.dispose().catch((error: unknown) => { failures.push(error) })
    streamSpy.mockRestore(); invokeSpy.mockRestore()
    stopDisposed(); stopEvents()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android attachment receipt recovery failed')
}, 300_000)
