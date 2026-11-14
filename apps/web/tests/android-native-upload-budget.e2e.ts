/** Native SAF upload admission includes the complete signed HTTP body and preserves existing input. */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-attachment'
import type { FileUploadValue } from '@deepseek-ai/dsh-client-file-upload'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const execute = promisify(execFile)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const BODY_BUDGET = 2048

interface Draft {
  text: string
  requestId: string
  attachments: { receiptId: string; attachmentId: string; name: string; bytes: number }[]
}
interface InputSnapshot {
  pid: number
  hostId: string
  hostKey: string
  generation: number
  sessionOwner: number
  input: { drafts: Record<string, Draft>; pending: Record<string, { sessionId: string; draft: Draft }> }
}
interface HttpSnapshot { started: number; finished: number; generation: number }

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android checks the discovered complete upload budget before sending a SAF file', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-upload-budget.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const events: SessionEvent[] = []
  const calls: string[] = []
  const uploads: FileUploadValue[] = []
  let inFlight = 0
  let targetSessionId: string | undefined
  const prefix = `dsh-native-budget-${randomUUID()}`
  const documents = [
    { name: `${prefix}-预算.bin`, bytes: Buffer.alloc(1280, 0x7a) },
    { name: `${prefix}-small.bin`, bytes: Buffer.from([0, 255, 13, 10, 128, 42, 1, 0]) },
  ] as const
  const owned = new Set<string>()
  const destination = (name: string) => {
    if (!name.startsWith(prefix) || !documents.some(document => document.name === name)) throw new Error('Unexpected owned budget filename')
    return `/sdcard/Download/${name}`
  }
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 30_000 })
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    calls.push(endpoint)
    inFlight++
    try {
      const result = await invoke(request)
      if (endpoint === 'fileUploads/upload') uploads.push(result as FileUploadValue)
      return result
    } finally { inFlight-- }
  })
  const stopEvents = scaffold.ctx.on('session/event', (session, event) => { if (session.id === targetSessionId) events.push(event) })
  const count = (endpoint: string) => calls.filter(value => value === endpoint).length
  let stage = 'prepare-files'
  try {
    const folder = fileURLToPath(new URL('../../../.artifacts/android-native-upload-budget-ui/', import.meta.url))
    const inputs = join(folder, 'inputs')
    await mkdir(inputs, { recursive: true })
    for (const document of documents) {
      const local = join(inputs, document.name)
      await writeFile(local, document.bytes)
      owned.add(document.name)
      await run('push', local, destination(document.name))
    }
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    targetSessionId = sessionId
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    expect(host.capabilities).toContain('native-remote.http-request-budget.v1')
    driver = await startAndroidCompanionUiDriver(adb, serial, info.port, true)
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const snapshot = async () => await command({ op: 'foregroundSnapshot' }) as InputSnapshot
    const http = async () => await command({ op: 'nativeHttpSnapshot' }) as HttpSnapshot
    const capture = async (name: string) => {
      const image = await command({ op: 'screenshot' })
      if (typeof image !== 'string') throw new Error('Missing Android budget screenshot')
      await writeFile(join(folder, name), Buffer.from(image, 'base64'))
    }
    const settle = async () => await vi.waitFor(async () => {
      const before = await http()
      const observedCalls = calls.slice()
      expect(inFlight).toBe(0)
      const after = await http()
      expect(after).toEqual(before)
      expect(after.started).toBe(after.finished)
      expect(calls).toEqual(observedCalls)
      expect(inFlight).toBe(0)
      return { ...after, calls: observedCalls }
    }, { timeout: 30_000 })
    const pick = async (document: (typeof documents)[number]) => {
      await command({ op: 'openAttachmentPicker' })
      await command({ op: 'finishAttachmentPick', filename: document.name })
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair-and-open'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    const initial = await snapshot()

    // A real transport refusal creates an independent pending intent without consuming the replay turn.
    stage = 'preserve-pending-intent'
    const oldText = '旧'.repeat(700)
    expect(Buffer.byteLength(oldText)).toBeGreaterThan(BODY_BUDGET)
    await command({ op: 'fillPromptDraft', text: oldText })
    await command({ op: 'hidePromptKeyboard' })
    const beforePending = await settle()
    await command({ op: 'submitPromptDraft' })
    await command({ op: 'assertPromptTransportFailure' })
    const afterPending = await settle()
    expect(afterPending.started - beforePending.started).toBe(afterPending.calls.length - beforePending.calls.length + 1)
    expect(count('session/prompt')).toBe(0)
    const pendingId = await command({ op: 'pendingPrompt', text: oldText }) as string
    const originalPending = (await snapshot()).input.pending[pendingId]!
    const text = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    await command({ op: 'replacePromptDraft', text })
    await command({ op: 'hidePromptKeyboard' })
    const draft = (await snapshot()).input.drafts[sessionId]!
    expect(draft.requestId).not.toBe(pendingId)
    expect(draft.attachments).toEqual([])

    stage = 'local-complete-body-refusal'
    const encodedArgsBytes = Buffer.byteLength(JSON.stringify({ agentId: sessionId,
      request: { data: documents[0].bytes.toString('base64'), name: documents[0].name } }))
    expect(documents[0].bytes.length).toBeLessThan(512 * 1024)
    expect(encodedArgsBytes).toBeLessThanOrEqual(BODY_BUDGET)
    const beforeUpload = await settle()
    await pick(documents[0])
    await command({ op: 'assertAttachmentFailure', issue: 'REQUEST_TOO_LARGE' })
    const afterUpload = await settle()
    expect(count('nativeRemote/httpRequestBudget')).toBe(1)
    expect(count('fileUploads/upload')).toBe(0)
    expect(count('session/prompt')).toBe(0)
    // Picker return can refresh the description. Every actual HTTP call must still reach a recorded unary method.
    expect(afterUpload.started - beforeUpload.started).toBe(afterUpload.calls.length - beforeUpload.calls.length)
    const refused = await snapshot()
    expect(refused.input.drafts[sessionId]).toEqual(draft)
    expect(refused.input.pending[pendingId]).toEqual(originalPending)
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toEqual([])
    await capture('budget-refused.png')

    stage = 'explicit-smaller-selection'
    await command({ op: 'discardPendingPrompt', requestId: pendingId })
    expect((await snapshot()).input.drafts[sessionId]).toEqual(draft)
    await pick(documents[1])
    await command({ op: 'awaitAttachmentReady' })
    await settle()
    expect(count('nativeRemote/httpRequestBudget')).toBe(2)
    expect(count('fileUploads/upload')).toBe(1)
    expect(count('session/prompt')).toBe(0)
    expect(uploads).toHaveLength(1)
    const stored = await readFile(scaffold.ctx.attachments.fileHostPath(uploads[0]!.file)!)
    expect(digest(stored)).toBe(digest(documents[1].bytes))
    const ready = (await snapshot()).input.drafts[sessionId]!
    expect(ready.text).toBe(text)
    expect(ready.requestId).not.toBe(draft.requestId)
    expect(ready.attachments).toMatchObject([
      { receiptId: uploads[0]!.receiptId, name: documents[1].name, bytes: documents[1].bytes.length },
    ])
    await capture('smaller-file-ready.png')

    stage = 'explicit-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => events.some(event => event.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    await settle()
    expect(count('session/prompt')).toBe(1)
    expect(count('fileUploads/upload')).toBe(1)
    expect(count('nativeRemote/httpRequestBudget')).toBe(2)
    const userMessages = events.filter(event => event.type === 'user/message').filter(event => event.data.source.kind === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]!.data.source).toMatchObject({ kind: 'user', rpcId: ready.requestId })
    expect(userMessages[0]!.data.content).toEqual([{ type: 'text', text }, { type: 'file', attachment: uploads[0]!.file }])
    const final = await snapshot()
    for (const key of ['pid', 'hostId', 'hostKey', 'generation', 'sessionOwner'] as const) expect(final[key]).toBe(initial[key])
    expect(final.input.drafts[sessionId]).toBeUndefined()
    expect(final.input.pending).toEqual({})
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await command({ op: 'assertAttachmentMessage', seq: userMessages[0]!.seq, names: [documents[1].name] })
    await capture('sent-smaller-file.png')
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-native-upload-budget.expected.md', import.meta.url)), [
      '# Android complete upload request budget', '',
      '- Installed application and instrumentation APK hashes match the tested builds.',
      '- A real Host transport refusal preserves an old pending prompt before the composer is edited independently.',
      '- The paired Host advertises a 2048-byte HTTP body budget through its versioned native capability.',
      '- A real SAF file fits the local source limit and the Host budget as encoded arguments, but its complete signed request is refused locally.',
      '- The refusal preserves both the old pending prompt and the newer draft, with zero upload or prompt invocation.',
      '- Completed client HTTP counts match the observed unary calls, including picker-return discovery, so no extra upload POST reaches the Host.',
      '- Explicit discard preserves the newer draft; another explicit SAF selection queries the budget again and uploads a smaller file.',
      '- Host storage bytes match the selected file, and only the final explicit send creates one durable user message.',
      '- The Android process, Host identity, model owner and one device grant remain unchanged through recovery.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android upload budget stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await vi.waitFor(() => { expect(inFlight).toBe(0) }).catch((error: unknown) => { failures.push(error) })
    for (const name of owned) await run('shell', 'rm', '-f', '--', destination(name)).catch((error: unknown) => { failures.push(error) })
    stopEvents()
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android upload budget acceptance failed')
}, 300_000)
