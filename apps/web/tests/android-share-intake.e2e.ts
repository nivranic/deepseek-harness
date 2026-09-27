/** Real DocumentsUI sharing grants source access only to the explicitly confirmed draft import. */
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
import type { FileUploadValue, ImageUploadValue } from '@deepseek-ai/dsh-client-file-upload'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const IMAGE = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
const execute = promisify(execFile)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface SharedDraft {
  requestId: string | null
  text: string
  attachments: { type: 'file' | 'image'; receiptId: string; attachmentId: string; name: string; bytes: number }[]
}

interface IntakeSnapshot { phase: string; arrival: number; text: string | null; count: number }

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android confirms real shared sources as one complete draft without replaying intake', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: string[] = []
  const uploads: ({ type: 'image'; value: ImageUploadValue } | { type: 'file'; value: FileUploadValue })[] = []
  const events: SessionEvent[] = []
  let observedSessionId: string | undefined
  const releaseSecondUpload = Promise.withResolvers<undefined>()
  let secondUploadPending = false
  const owned = new Set<string>()
  const prefix = `dsh-native-share-${randomUUID()}`
  const names = [`${prefix}-image.png`, `${prefix}-file.bin`]
  const documentBytes = [await readFile(IMAGE), Buffer.from([0, 127, 255, 42, 10])]
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 30_000 })
  const destination = (name: string) => {
    if (!names.includes(name)) throw new Error('Unexpected shared test filename')
    return `/sdcard/Download/${name}`
  }
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    if (['fileUploads/upload', 'fileUploads/uploadImage', 'session/prompt'].includes(endpoint)) calls.push(endpoint)
    if (endpoint.startsWith('fileUploads/') && calls.length === 2) {
      secondUploadPending = true
      await releaseSecondUpload.promise
    }
    const value = await invoke(request)
    if (endpoint === 'fileUploads/uploadImage') uploads.push({ type: 'image', value: value as ImageUploadValue })
    if (endpoint === 'fileUploads/upload') uploads.push({ type: 'file', value: value as FileUploadValue })
    return value
  })
  const stopObserving = scaffold.ctx.on('session/event', (session, event) => { if (session.id === observedSessionId) events.push(event) })
  let stage = 'prepare'
  try {
    const folder = fileURLToPath(new URL('../../../.artifacts/android-share-intake-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    for (const [index, name] of names.entries()) {
      const path = join(folder, name)
      await writeFile(path, documentBytes[index]!)
      owned.add(name)
      await run('push', path, destination(name))
    }
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    observedSessionId = sessionId
    await scaffold.ctx.sessionController.selectModel({ sessionId, provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' })
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const start = (reset: boolean) => startAndroidCompanionUiDriver(adb, serial, info.port, reset)
    driver = await start(true)
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, `${stage}: ${JSON.stringify(result)}`).toBe('ok')
      return result.value
    }
    const capture = async (name: string, image?: unknown) => {
      if (image !== undefined && typeof image !== 'string') throw new Error('Missing Android screenshot')
      const screenshot = typeof image === 'string' ? Buffer.from(image, 'base64') :
        (await execute(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 30_000, encoding: 'buffer' })).stdout
      await writeFile(join(folder, name), screenshot)
    }
    const draft = async () => await command({ op: 'shareDraftSnapshot' }) as SharedDraft
    const intake = async () => await command({ op: 'shareIntakeSnapshot' }) as IntakeSnapshot
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    const text = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    await command({ op: 'fillPromptDraft', text })
    const original = await draft()
    stage = 'review-and-cancel-real-files-share'
    const chooser = await command({ op: 'openSystemFileShare', names: [names[1]] }) as { package: string; screenshot: string }
    expect(['android', 'com.android.intentresolver']).toContain(chooser.package)
    await capture('system-sharesheet.png', chooser.screenshot)
    await command({ op: 'chooseShareReceiver' })
    expect(await intake()).toMatchObject({ phase: 'REVIEW', count: 1 })
    expect(await draft()).toEqual(original)
    expect(calls).toEqual([])
    await capture('share-review.png')
    await command({ op: 'dismissSharedDraft' })
    await expect.poll(async () => (await intake()).phase).toBe('NONE')
    expect(await draft()).toEqual(original)
    expect(calls).toEqual([])

    stage = 'explicit-text-only-draft-import'
    const sharedText = 'Shared link: https://example.test/ordinary-text'
    await command({ op: 'deliverSharedText', text: sharedText })
    expect(await draft()).toEqual(original)
    await command({ op: 'confirmSharedDraft' })
    await expect.poll(async () => (await intake()).phase).toBe('ADOPTED')
    expect((await draft()).text).toBe(`${text}\n\n${sharedText}`)
    expect(calls).toEqual([])
    await command({ op: 'replacePromptDraft', text })
    const beforeBatch = await draft()

    stage = 'confirm-real-multiple-share-as-one-draft'
    await command({ op: 'openSystemFileShare', names })
    await command({ op: 'chooseShareReceiver' })
    expect(await intake()).toMatchObject({ phase: 'REVIEW', count: 2 })
    expect(await draft()).toEqual(beforeBatch)
    expect(calls).toEqual([])
    await command({ op: 'confirmSharedDraft' })
    await expect.poll(() => secondUploadPending, { timeout: 20_000 }).toBe(true)
    expect(uploads).toHaveLength(1)
    expect(await draft()).toEqual(beforeBatch)
    const deliveredNames = await command({ op: 'shareSourceNames' }) as string[]
    expect([...deliveredNames].sort()).toEqual([...names].sort())
    await command({ op: 'assertShareSubmissionBlocked' })
    const edited = `${text} Local edit during import.`
    await command({ op: 'replacePromptDraft', text: edited })
    releaseSecondUpload.resolve(undefined)
    await expect.poll(async () => (await intake()).phase, { timeout: 20_000 }).toBe('ADOPTED')
    const adopted = await draft()
    expect(adopted.text).toBe(edited)
    expect(adopted.attachments.map(item => item.name)).toEqual(deliveredNames)
    expect(uploads).toHaveLength(2)
    expect(calls.filter(call => call === 'session/prompt')).toEqual([])
    for (const upload of uploads) {
      const attachment = upload.type === 'image' ? upload.value.image : upload.value.file
      const expectedBytes = documentBytes[names.indexOf(attachment.name!)]!
      const path = upload.type === 'image'
        ? scaffold.ctx.attachments.imageHostPath(upload.value.image)! : scaffold.ctx.attachments.fileHostPath(upload.value.file)!
      expect(digest(await readFile(path))).toBe(digest(expectedBytes))
      expect(attachment.attachmentId).toBe(`sha256:${digest(expectedBytes)}`)
    }
    await command({ op: 'replacePromptDraft', text })
    const beforeDeath = await draft()
    await command({ op: 'assertAttachmentInputsEncrypted' })
    await capture('shared-draft.png')

    stage = 'pending-share-process-death'
    await command({ op: 'openSystemFileShare', names: [names[1]] })
    await command({ op: 'chooseShareReceiver' })
    expect(await intake()).toMatchObject({ phase: 'REVIEW', count: 1 })
    const callsBeforeDeath = [...calls]
    const pid = await command({ op: 'inputCheckpoint' })
    for (const [index, name] of names.entries()) {
      const hash = (await run('shell', 'sha256sum', destination(name))).stdout.split(/\s+/u)[0]
      expect(hash).toBe(digest(documentBytes[index]!))
      await run('shell', 'rm', '-f', '--', destination(name))
      owned.delete(name)
    }
    await driver.kill()
    driver = undefined
    driver = await start(false)
    expect(await command({ op: 'assertRestored' })).not.toBe(pid)
    await command({ op: 'openSession', sessionId })
    expect(await draft()).toEqual(beforeDeath)
    expect((await intake()).count).toBe(0)
    expect(calls).toEqual(callsBeforeDeath)
    await capture('shared-restored.png')

    stage = 'explicit-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => events.some(event => event.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    const messages = events.filter(event => event.type === 'user/message').filter(event => event.data.source.kind === 'user')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.data.source).toMatchObject({ kind: 'user', rpcId: beforeDeath.requestId })
    expect(messages[0]!.data.content).toEqual([{ type: 'text', text }, ...uploads.map(upload => upload.type === 'image'
      ? { type: 'image', attachment: upload.value.image } : { type: 'file', attachment: upload.value.file })])
    expect(calls).toEqual([...callsBeforeDeath, 'session/prompt'])
    await command({ op: 'assertAttachmentMessage', seq: messages[0]!.seq, names })
    await capture('shared-sent.png')
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-share-intake.expected.md', import.meta.url)), [
      '# Android share intake', '',
      '- Both installed acceptance APK hashes match the current build artifacts.',
      '- System Files shares test-owned sources through the real sharesheet to the distinctly labelled acceptance application.',
      '- Reviewing or dismissing a share preserves the draft and sends neither upload nor prompt.',
      '- Explicit text-only confirmation appends plain text and URLs without a Host call or automatic navigation.',
      '- A multiple-source import stages every member under one admission and leaves the old draft intact until all receipts arrive.',
      '- Model-level send stays blocked mid-batch; final adoption preserves text edited during upload and the delivered source order.',
      '- Independent Host file and image hashes match the known binary and metadata-free PNG; source files remain unchanged.',
      '- Removing test-owned sources and terminating the process discards pending intake while restoring the same completed draft and request identity.',
      '- Restart performs no upload or prompt; explicit send records the exact ordered image/file content with the restored request identity.',
      '- Model output uses a keyless recorded reply; physical devices, third-party share providers and live-model interpretation remain unverified.',
    ].join('\n'), MODE)
  } catch (error) {
    console.info('Android share intake stage', stage); failures.push(error)
    if (stage === 'review-and-cancel-real-files-share') {
      try {
        const screenshot = await execute(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 30_000, encoding: 'buffer' })
        await writeFile(fileURLToPath(new URL('../../../.artifacts/android-share-intake-ui/system-failure.png', import.meta.url)), screenshot.stdout)
      } catch (captureError) { failures.push(captureError) }
    }
  }
  finally {
    releaseSecondUpload.resolve(undefined)
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const name of owned) await run('shell', 'rm', '-f', '--', destination(name)).catch((error: unknown) => { failures.push(error) })
    stopObserving()
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android shared-source acceptance failed')
}, 300_000)
