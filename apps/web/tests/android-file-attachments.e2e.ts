/** Android SAF files become durable Host attachments only through explicit upload and prompt submission. */
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
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const execute = promisify(execFile)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface AttachmentDraft {
  requestId: string | null
  files: { receiptId: string; attachmentId: string; name: string; bytes: number }[]
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android picks files through SAF and restores encrypted attachment intents before explicit sending', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: string[] = []
  const uploads: FileUploadValue[] = []
  const events: SessionEvent[] = []
  let observedSessionId: string | undefined
  const owned = new Set<string>()
  const prefix = `dsh-native-attach-${randomUUID()}`
  const documents = [
    { name: `${prefix}-数据.bin`, bytes: Buffer.from([0, 255, 13, 10, 128, 42, 1, 0]) },
    { name: `${prefix}-empty.bin`, bytes: Buffer.alloc(0) },
    { name: `${prefix}-remove.bin`, bytes: Buffer.from('Remove this draft attachment') },
    { name: `${prefix}-oversize.bin`, bytes: Buffer.alloc(512 * 1024 + 1, 0x7a) },
  ] as const
  const destination = (name: string) => {
    if (!documents.some(document => document.name === name) || !name.startsWith(prefix)) throw new Error('Unexpected owned attachment filename')
    return `/sdcard/Download/${name}`
  }
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 30_000 })
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    if (endpoint === 'fileUploads/upload' || endpoint === 'session/prompt') calls.push(endpoint)
    const value = await invoke(request)
    if (endpoint === 'fileUploads/upload') uploads.push(value as FileUploadValue)
    return value
  })
  const stopObserving = scaffold.ctx.on('session/event', (session, event) => { if (session.id === observedSessionId) events.push(event) })
  let stage = 'prepare-documents'
  try {
    const folder = fileURLToPath(new URL('../../../.artifacts/android-file-attachments-ui/', import.meta.url))
    const inputs = join(folder, 'inputs')
    await mkdir(inputs, { recursive: true })
    for (const document of documents) {
      const local = join(inputs, document.name)
      await writeFile(local, document.bytes)
      owned.add(document.name)
      await run('push', local, destination(document.name))
    }
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    observedSessionId = sessionId
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const start = (reset: boolean) => startAndroidCompanionUiDriver(adb, serial, info.port, reset)
    driver = await start(true)
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const capture = async (name: string, image?: unknown) => {
      const screenshot = image ?? await command({ op: 'screenshot' })
      if (typeof screenshot !== 'string') throw new Error('Missing Android screenshot')
      await writeFile(join(folder, name), Buffer.from(screenshot, 'base64'))
    }
    const assertDraft = async (selected: readonly (typeof documents)[number][]) => await command({
      op: 'assertAttachments', files: selected.map(document => ({ name: document.name, bytes: document.bytes.length })),
    }) as AttachmentDraft
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
    const fixtureText = await readFile(FIXTURE, 'utf8')
    const text = fixtureUserPrompts(fixtureText)[0]!
    await command({ op: 'fillPromptDraft', text })
    stage = 'cancel-system-picker'
    await capture('system-picker.png', await command({ op: 'openAttachmentPicker' }))
    await command({ op: 'cancelAttachmentPicker' })
    await assertDraft([])
    await command({ op: 'assertPromptDraft', text })
    expect(calls).toEqual([])
    stage = 'oversize-local-refusal'
    await pick(documents[3])
    await command({ op: 'assertAttachmentFailure', issue: 'TOO_LARGE' })
    await assertDraft([])
    expect(calls).toEqual([])
    await capture('oversize-refused.png')
    stage = 'pick-real-files'
    for (let index = 0; index < 3; index++) {
      await pick(documents[index]!)
      await assertDraft(documents.slice(0, index + 1))
    }
    expect(calls).toEqual(Array<string>(3).fill('fileUploads/upload'))
    expect(uploads).toHaveLength(3)
    for (let index = 0; index < uploads.length; index++) {
      const ref = uploads[index]!.file
      const document = documents[index]!
      expect(ref).toMatchObject({ name: document.name, bytes: document.bytes.length })
      const storedPath = scaffold.ctx.attachments.fileHostPath(ref)
      expect(storedPath).toBeTypeOf('string')
      const stored = await readFile(storedPath!)
      expect(stored.length).toBe(document.bytes.length)
      expect(digest(stored)).toBe(digest(document.bytes))
    }
    const withRemovable = await assertDraft(documents.slice(0, 3))
    stage = 'remove-draft-attachment'
    await command({ op: 'removeAttachment', receiptId: withRemovable.files[2]!.receiptId })
    const retained = documents.slice(0, 2)
    const beforeDeath = await assertDraft(retained)
    expect(calls).toEqual(Array<string>(3).fill('fileUploads/upload'))
    await command({ op: 'assertAttachmentInputsEncrypted' })
    await capture('attachments-before-death.png')
    const pid = await command({ op: 'inputCheckpoint' })
    await driver.kill()
    driver = undefined
    stage = 'restore-without-upload-or-prompt'
    driver = await start(false)
    expect(await command({ op: 'assertRestored' })).not.toBe(pid)
    await command({ op: 'assertCurrentHost', hostId: host.hostId, count: 1 })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'assertPromptDraft', text })
    expect(await assertDraft(retained)).toEqual(beforeDeath)
    await command({ op: 'assertAttachmentInputsEncrypted' })
    expect(calls).toEqual(Array<string>(3).fill('fileUploads/upload'))
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await capture('attachments-restored.png')
    stage = 'explicit-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => events.some(event => event.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    await assertDraft([])
    expect(calls).toEqual(['fileUploads/upload', 'fileUploads/upload', 'fileUploads/upload', 'session/prompt'])
    const messages = events.filter(event => event.type === 'user/message')
    console.info('Android attachment message sources', messages.map(event => ({
      seq: event.seq,
      sourceKind: event.data.source.kind,
      matchesPromptRequest: event.data.source.kind === 'user' && 'rpcId' in event.data.source
        && event.data.source.rpcId === beforeDeath.requestId,
      systemPromptSnapshot: event.data.source.kind === 'plugin' && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt'
        && 'form' in event.data.source && event.data.source.form === 'snapshot',
    })))
    const userMessages = messages.filter(event => event.data.source.kind === 'user')
    expect(userMessages.length).toBe(1)
    const message = userMessages[0]!
    if (message.type !== 'user/message') throw new Error('Missing durable user message')
    expect(message.data.source).toMatchObject({ kind: 'user', rpcId: beforeDeath.requestId })
    expect(message.data.content).toEqual([
      { type: 'text', text },
      ...uploads.slice(0, 2).map(upload => ({ type: 'file', attachment: upload.file })),
    ])
    const contextMetadata = (source: UserMessage['source']) => {
      expect(source.kind).toBe('plugin')
      if (source.kind !== 'plugin') throw new Error('Unexpected non-user message source')
      expect(source.plugin).toBe('@deepseek-ai/dsh-system-prompt')
      const snapshot = source as typeof source & { form: string; sections: readonly { name: string }[] }
      expect(snapshot.form).toBe('snapshot')
      return { keys: Object.keys(source).sort(), kind: source.kind, plugin: source.plugin,
        form: snapshot.form, sections: snapshot.sections.map(section => ({ keys: Object.keys(section).sort(), name: section.name })) }
    }
    const fixtureContexts = fixtureText.trim().split(/\r?\n/u).flatMap((line) => {
      const event = JSON.parse(line) as { type: string; data: UserMessage }
      return event.type === 'user/message' && event.data.source.kind !== 'user' ? [contextMetadata(event.data.source)] : []
    })
    expect(messages.filter(event => event.data.source.kind !== 'user').map(event => contextMetadata(event.data.source)))
      .toEqual(fixtureContexts)
    await command({ op: 'assertAttachmentMessage', seq: message.seq, names: retained.map(document => document.name) })
    await capture('sent-files.png')
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-file-attachments.expected.md', import.meta.url)), [
      '# Android Files attachments', '',
      '- Installed application and instrumentation APK hashes match their current build artifacts.',
      '- The explicit composer Files action opens the real single-document SAF picker.',
      '- Picker cancellation preserves the text draft and sends neither fileUploads/upload nor session/prompt.',
      '- A file larger than 512 KiB is refused locally before any upload or prompt.',
      '- SAF uploads Chinese-named binary and empty files; independent Host storage hashes match the selected bytes.',
      '- Removing a staged attachment changes only the local draft and sends no further upload or prompt.',
      '- Draft text, attachment names and identities are absent from the encrypted input file raw bytes.',
      '- Actual process termination restores the same grant, text, file receipts and request identity without uploading or sending.',
      '- Explicit sending produces one durable user message containing the retained FileBlocks and renders their filenames on Android.',
      '- Photos, Camera, share intents and third-party document providers are outside this scenario.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android file attachments stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const name of owned) await run('shell', 'rm', '-f', '--', destination(name)).catch((error: unknown) => { failures.push(error) })
    stopObserving()
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android file attachment acceptance failed')
}, 300_000)
