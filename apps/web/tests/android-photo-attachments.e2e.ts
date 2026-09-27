/** The installed system Photo Picker supplies ordered image receipts without replaying source reads after process death. */
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
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const IMAGE = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
const execute = promisify(execFile)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface MixedDraft {
  requestId: string | null
  text: string
  attachments: { type: 'image' | 'file'; receiptId: string; attachmentId: string; name?: string; bytes: number }[]
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android restores ordered Photos and Files receipts before explicit vision submission', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: string[] = []
  const images: ImageUploadValue[] = []
  const files: FileUploadValue[] = []
  const events: SessionEvent[] = []
  let observedSessionId: string | undefined
  let photoUri: string | undefined
  let documentOwned = false
  const identifier = randomUUID()
  const photoName = `dsh-native-photo-${identifier}.png`
  const fileName = `dsh-native-photo-${identifier}.bin`
  const fileBytes = Buffer.from([0, 255, 42, 13, 10])
  const destination = `/sdcard/Download/${fileName}`
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true, timeout: 30_000 })
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    if (['fileUploads/upload', 'fileUploads/uploadImage', 'session/prompt'].includes(endpoint)) calls.push(endpoint)
    const value = await invoke(request)
    if (endpoint === 'fileUploads/uploadImage') images.push(value as ImageUploadValue)
    if (endpoint === 'fileUploads/upload') files.push(value as FileUploadValue)
    return value
  })
  const stopObserving = scaffold.ctx.on('session/event', (session, event) => { if (session.id === observedSessionId) events.push(event) })
  let stage = 'prepare'
  try {
    const folder = fileURLToPath(new URL('../../../.artifacts/android-photo-attachments-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const original = await readFile(IMAGE)
    expect(digest(original)).toBe('b1ff9c8ea3a780bad09b346c423d2d0e46815926879b18e841d928376a946640')
    const localFile = join(folder, fileName)
    await writeFile(localFile, fileBytes)
    documentOwned = true
    await run('push', localFile, destination)
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    observedSessionId = sessionId
    await scaffold.ctx.sessionController.selectModel({ sessionId, provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' })
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    expect(host.capabilities).toContain('image-upload.stage.v1')
    const start = (reset: boolean) => startAndroidCompanionUiDriver(adb, serial, info.port, reset)
    driver = await start(true)
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, `${stage}: ${JSON.stringify(result)}`).toBe('ok')
      return result.value
    }
    const capture = async (name: string, image?: unknown) => {
      const screenshot = image ?? await command({ op: 'screenshot' })
      if (typeof screenshot !== 'string') throw new Error('Missing Android screenshot')
      await writeFile(join(folder, name), Buffer.from(screenshot, 'base64'))
    }
    const draft = async () => await command({ op: 'assertMixedAttachments' }) as MixedDraft
    const assertKinds = async (types: readonly string[]) => {
      await expect.poll(async () => (await draft()).attachments.map(item => item.type), { timeout: 20_000 }).toEqual(types)
      return draft()
    }
    const pickPhoto = async () => {
      await command({ op: 'openPhotoPicker' })
      await command({ op: 'finishPhotoPick', index: 0 })
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
    const stagedPhoto = await command({ op: 'stageTestPhoto', name: photoName, data: original.toString('base64') }) as { uri: string }
    photoUri = stagedPhoto.uri
    expect(photoUri).toMatch(/^content:\/\/media\/external(?:_primary)?\/images\/media\/\d+$/u)
    stage = 'cancel-system-photo-picker'
    const picker = await command({ op: 'openPhotoPicker' }) as { screenshot: string; package: string }
    expect(picker.package).toContain('providers.media')
    await capture('system-photo-picker.png', picker.screenshot)
    await command({ op: 'cancelPhotoPicker' })
    await assertKinds([])
    expect(calls).toEqual([])
    stage = 'select-mixed-attachments'
    await pickPhoto()
    await assertKinds(['image'])
    await command({ op: 'openAttachmentPicker' })
    await command({ op: 'finishAttachmentPick', filename: fileName })
    await assertKinds(['image', 'file'])
    await pickPhoto()
    const beforeRemoval = await assertKinds(['image', 'file', 'image'])
    expect(calls).toEqual(['fileUploads/uploadImage', 'fileUploads/upload', 'fileUploads/uploadImage'])
    await command({ op: 'removeAttachment', receiptId: beforeRemoval.attachments[2]!.receiptId })
    await assertKinds(['image', 'file'])
    expect(calls).toHaveLength(3)
    await pickPhoto()
    const beforeDeath = await assertKinds(['image', 'file', 'image'])
    expect(beforeDeath.attachments[2]!.receiptId).not.toBe(beforeRemoval.attachments[2]!.receiptId)
    expect(images).toHaveLength(3)
    expect(files).toHaveLength(1)
    for (const { image } of images) {
      expect(image).toMatchObject({ mediaType: 'image/png', bytes: original.length, width: 1, height: 1 })
      const stored = await readFile(scaffold.ctx.attachments.imageHostPath(image)!)
      expect(digest(stored)).toBe(digest(original))
      expect(image.attachmentId).toBe(`sha256:${digest(original)}`)
    }
    expect(digest(await readFile(scaffold.ctx.attachments.fileHostPath(files[0]!.file)!))).toBe(digest(fileBytes))
    await command({ op: 'assertAttachmentInputsEncrypted' })
    await capture('mixed-before-death.png')
    const callsBeforeDeath = [...calls]
    const pid = await command({ op: 'inputCheckpoint' })
    await command({ op: 'cleanupTestPhoto', uri: photoUri })
    photoUri = undefined
    await driver.kill()
    driver = undefined
    stage = 'restore-without-source-access-or-submit'
    driver = await start(false)
    expect(await command({ op: 'assertRestored' })).not.toBe(pid)
    await command({ op: 'assertCurrentHost', hostId: host.hostId, count: 1 })
    await command({ op: 'openSession', sessionId })
    expect(await assertKinds(['image', 'file', 'image'])).toEqual(beforeDeath)
    await command({ op: 'assertAttachmentInputsEncrypted' })
    expect(calls).toEqual(callsBeforeDeath)
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await capture('mixed-restored.png')
    stage = 'explicit-vision-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => events.some(event => event.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    await assertKinds([])
    expect(calls).toEqual([...callsBeforeDeath, 'session/prompt'])
    const messages = events.filter(event => event.type === 'user/message')
    const userMessages = messages.filter(event => event.data.source.kind === 'user')
    expect(userMessages).toHaveLength(1)
    const message = userMessages[0]!
    expect(message.data.source).toMatchObject({ kind: 'user', rpcId: beforeDeath.requestId })
    expect(message.data.content).toEqual([
      { type: 'text', text },
      { type: 'image', attachment: images[0]!.image },
      { type: 'file', attachment: files[0]!.file },
      { type: 'image', attachment: images[2]!.image },
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
    const read = await scaffold.ctx.sessionController.attachment({ sessionId, attachmentId: images[0]!.image.attachmentId })
    expect(digest(Buffer.from(read.data, 'base64'))).toBe(digest(original))
    await command({ op: 'assertAttachmentMessage', seq: message.seq, names: [files[0]!.file.name, images[0]!.image.name!] })
    await capture('sent-images-and-file.png')
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-photo-attachments.expected.md', import.meta.url)), [
      '# Android Photos and Files attachments', '',
      '- Both installed acceptance APK hashes match the current build artifacts.',
      '- The explicit Photos action opens the real system image picker without broad media permission.',
      '- Cancelling preserves the draft and sends neither upload nor prompt.',
      '- Photos and SAF Files share one ordered draft; removing an image makes no Host call and reselecting creates a new receipt.',
      '- Independent Host storage hashes match the known metadata-free PNG and binary file; image references retain raster dimensions and MIME.',
      '- Raw encrypted input contains no draft text or attachment identities.',
      '- After removing the test-owned source photo, actual process termination restores the same grant, mixed order and request identity without upload or prompt.',
      '- Explicit sending records one user-origin message with ImageBlock, FileBlock and ImageBlock in the selected order.',
      '- Session-authorized image reading returns the verified PNG; Android renders the sent attachment names.',
      '- Vision response uses a keyless recorded reply; live-model image understanding, Camera and share intents remain unverified.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android photo attachments stage', stage); failures.push(error) }
  finally {
    if (photoUri !== undefined && driver !== undefined) {
      await driver.request({ op: 'cleanupTestPhoto', uri: photoUri }).then((result) => {
        if (result.type !== 'ok') throw new Error('Owned photo cleanup failed')
      }).catch((error: unknown) => { failures.push(error) })
    }
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    if (documentOwned) await run('shell', 'rm', '-f', '--', destination).catch((error: unknown) => { failures.push(error) })
    stopObserving()
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android photo attachment acceptance failed')
}, 300_000)
