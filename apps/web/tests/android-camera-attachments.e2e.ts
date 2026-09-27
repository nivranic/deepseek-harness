/** Installed Camera output stays owned until image staging settles and never restores upload authority. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-attachment'
import type { ImageUploadValue } from '@deepseek-ai/dsh-client-file-upload'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface CameraDraft {
  requestId: string | null
  text: string
  attachments: { type: 'image'; receiptId: string; attachmentId: string; name: string; bytes: number }[]
}

interface CaptureFile {
  name: string
  bytes: number
  sha256: string
  width: number
  height: number
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android stages full-size Camera output and restores only completed receipts', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: string[] = []
  const events: SessionEvent[] = []
  const images: ImageUploadValue[] = []
  let observedSessionId: string | undefined
  let uploaded: Buffer | undefined
  const releaseUpload = Promise.withResolvers<undefined>()
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    if (['fileUploads/upload', 'fileUploads/uploadImage', 'session/prompt'].includes(endpoint)) calls.push(endpoint)
    if (endpoint === 'fileUploads/uploadImage') {
      const input = request.args.request as { data: string; mediaType: string }
      expect(input.mediaType).toBe('image/jpeg')
      uploaded = Buffer.from(input.data, 'base64')
      await releaseUpload.promise
    }
    const value = await invoke(request)
    if (endpoint === 'fileUploads/uploadImage') images.push(value as ImageUploadValue)
    return value
  })
  const stopObserving = scaffold.ctx.on('session/event', (session, event) => { if (session.id === observedSessionId) events.push(event) })
  let stage = 'prepare'
  try {
    const folder = fileURLToPath(new URL('../../../.artifacts/android-camera-attachments-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    observedSessionId = sessionId
    await scaffold.ctx.sessionController.selectModel({ sessionId, provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' })
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    expect(host.capabilities).toContain('image-upload.stage.v1')
    const start = (reset: boolean) => startAndroidCompanionUiDriver(
      process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, reset,
    )
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
    const draft = async () => await command({ op: 'assertMixedAttachments' }) as CameraDraft
    const captures = async () => await command({ op: 'cameraTemporaryFiles' }) as CaptureFile[]
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    const text = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    await command({ op: 'fillPromptDraft', text })
    const originalDraft = await draft()
    expect(await captures()).toEqual([])
    stage = 'cancel-camera'
    const camera = await command({ op: 'openCamera' }) as { package: string; screenshot: string }
    expect(camera.package).toBe('com.android.camera2')
    await capture('system-camera.png', camera.screenshot)
    expect(await captures()).toHaveLength(1)
    await command({ op: 'cancelCamera' })
    expect(await draft()).toEqual(originalDraft)
    expect(await captures()).toEqual([])
    expect(calls).toEqual([])

    stage = 'capture-full-size-and-read-owned-output'
    await command({ op: 'openCamera' })
    await command({ op: 'finishCameraCapture' })
    await expect.poll(() => uploaded !== undefined, { timeout: 20_000 }).toBe(true)
    const sourceFiles = await captures()
    expect(sourceFiles).toHaveLength(1)
    const source = sourceFiles[0]!
    expect(source.bytes).toBeGreaterThan(0)
    expect(source.bytes).toBeLessThanOrEqual(524_288)
    expect(source.width).toBeGreaterThan(256)
    expect(source.height).toBeGreaterThan(256)
    expect(source.sha256).toBe(digest(uploaded!))
    expect(source.bytes).toBe(uploaded!.length)
    expect(uploaded!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    await command({ op: 'assertAttachmentSendBlocked' })
    releaseUpload.resolve(undefined)
    await expect.poll(() => images.length, { timeout: 20_000 }).toBe(1)
    const beforeDeath = await draft()
    expect(beforeDeath.attachments).toHaveLength(1)
    expect(beforeDeath.attachments[0]!.type).toBe('image')
    await expect.poll(captures, { timeout: 20_000 }).toEqual([])
    const image = images[0]!.image
    const stored = await readFile(scaffold.ctx.attachments.imageHostPath(image)!)
    expect(image.attachmentId).toBe(`sha256:${digest(stored)}`)
    expect(image.bytes).toBe(stored.length)
    expect(image.width).toBeGreaterThan(0)
    expect(image.height).toBeGreaterThan(0)
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(Math.max(source.width, source.height))
    expect(await command({ op: 'decodeCameraImage', data: stored.toString('base64') }))
      .toEqual({ width: image.width, height: image.height, mediaType: image.mediaType })
    expect(beforeDeath.attachments[0]).toMatchObject({ receiptId: images[0]!.receiptId, attachmentId: image.attachmentId })
    await writeFile(join(folder, 'capture-observation.json'), JSON.stringify({ source, stored: {
      bytes: stored.length, sha256: digest(stored), width: image.width, height: image.height, mediaType: image.mediaType,
    } }, null, 2) + '\n')
    await command({ op: 'assertAttachmentInputsEncrypted' })
    await capture('camera-draft.png')

    stage = 'kill-with-another-camera-selection-pending'
    const pid = await command({ op: 'inputCheckpoint' })
    await command({ op: 'openCamera' })
    expect(await captures()).toHaveLength(1)
    await driver.kill()
    driver = undefined
    stage = 'restore-without-upload-authority'
    driver = await start(false)
    expect(await command({ op: 'assertRestored' })).not.toBe(pid)
    await command({ op: 'assertCurrentHost', hostId: host.hostId, count: 1 })
    await command({ op: 'openSession', sessionId })
    expect(await draft()).toEqual(beforeDeath)
    expect(await captures()).toEqual([])
    expect(calls).toEqual(['fileUploads/uploadImage'])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await capture('camera-restored.png')

    stage = 'explicit-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => events.some(event => event.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    expect((await draft()).attachments).toEqual([])
    const messages = events.filter(event => event.type === 'user/message').filter(event => event.data.source.kind === 'user')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.data).toMatchObject({ source: { kind: 'user', rpcId: beforeDeath.requestId } })
    expect(messages[0]!.data.content).toEqual([{ type: 'text', text }, { type: 'image', attachment: image }])
    expect(calls).toEqual(['fileUploads/uploadImage', 'session/prompt'])
    const read = await scaffold.ctx.sessionController.attachment({ sessionId, attachmentId: image.attachmentId })
    expect(digest(Buffer.from(read.data, 'base64'))).toBe(digest(stored))
    await command({ op: 'assertAttachmentMessage', seq: messages[0]!.seq, names: [image.name!] })
    await capture('camera-sent.png')
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-camera-attachments.expected.md', import.meta.url)), [
      '# Android Camera attachments', '',
      '- Both installed acceptance APK hashes match the current build artifacts.',
      '- The explicit Camera action opens the installed system camera with a full-size, app-owned JPEG output.',
      '- Cancelling preserves the exact draft, removes the owned temporary file and makes no Host call.',
      '- The independently read temporary file hash matches the uploaded JPEG; its dimensions exceed thumbnail size.',
      '- Sending stays unavailable while staging is held; completion removes the capture after the Host operation settles.',
      '- Independent Host storage hashing matches the image reference; normalization can change encoding and remove metadata.',
      '- Actual process termination with another Camera selection pending restores only the completed receipt and draft identity.',
      '- Restart removes the orphan capture without restoring upload authority or issuing a prompt.',
      '- Explicit sending records one user-origin ImageBlock; Session-authorized image reading returns the stored bytes.',
      '- Model output uses a keyless recorded reply; physical cameras, live visual understanding and share intents remain unverified.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android camera attachments stage', stage); failures.push(error) }
  finally {
    releaseUpload.resolve(undefined)
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    stopObserving()
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android Camera attachment acceptance failed')
}, 300_000)
