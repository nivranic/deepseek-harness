/** Native Photo Picker image upload admission includes the complete signed HTTP body and preserves the typed draft. */
import { createHash, randomUUID } from 'node:crypto'
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
const IMAGE = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const BODY_BUDGET = 2048
const PHOTO_URI = /^content:\/\/media\/external(?:_primary)?\/images\/media\/\d+$/u

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

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  const out = Buffer.alloc(4)
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
  return out
}

/** Grow the PNG to targetBytes with one ancillary tEXt chunk; decoders skip it, so the padded image stays a valid 1×1 PNG. */
const pngWithPadding = (source: Buffer, targetBytes: number) => {
  const chunks: Buffer[] = []
  for (let offset = 8; offset < source.length;) {
    const dataLength = source.readUInt32BE(offset)
    const end = offset + 12 + dataLength
    if (crc32(source.subarray(offset + 4, end - 4)).equals(source.subarray(end - 4, end))) chunks.push(source.subarray(offset, end))
    else throw new Error('Source PNG chunk CRC mismatch')
    offset = end
  }
  if (chunks.length < 2 || chunks[0]!.subarray(4, 8).toString('latin1') !== 'IHDR') throw new Error('Source PNG is missing IHDR')
  const keyword = Buffer.from('Comment\0', 'latin1')
  const dataLength = targetBytes - source.length - 12
  if (dataLength <= keyword.length) throw new Error('Padding does not fit the target PNG size')
  const data = Buffer.concat([keyword, Buffer.alloc(dataLength - keyword.length, 0x50)])
  const type = Buffer.from('tEXt', 'latin1')
  const lengthField = Buffer.alloc(4)
  lengthField.writeUInt32BE(data.length, 0)
  return Buffer.concat([source.subarray(0, 8), chunks[0]!,
    lengthField, type, data, crc32(Buffer.concat([type, data])), ...chunks.slice(1)])
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android checks the discovered complete upload budget before sending a Photo Picker image', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-upload-budget.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const events: SessionEvent[] = []
  const calls: string[] = []
  const images: ImageUploadValue[] = []
  let inFlight = 0
  let targetSessionId: string | undefined
  let ownedPhotoUri: string | undefined
  const identifier = randomUUID()
  const bigName = `dsh-native-photo-${identifier}-big.png`
  const smallName = `dsh-native-photo-${identifier}-small.png`
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    calls.push(endpoint)
    inFlight++
    try {
      const result = await invoke(request)
      if (endpoint === 'fileUploads/uploadImage') images.push(result as ImageUploadValue)
      return result
    } finally { inFlight-- }
  })
  const stopEvents = scaffold.ctx.on('session/event', (session, event) => { if (session.id === targetSessionId) events.push(event) })
  const count = (endpoint: string) => calls.filter(value => value === endpoint).length
  let stage = 'prepare-photos'
  const folder = fileURLToPath(new URL('../../../.artifacts/android-native-image-upload-budget-ui/', import.meta.url))
  const command = async (request: object) => {
    const result = await driver!.request(request)
    expect(result.type, stage).toBe('ok')
    return result.value
  }
  const snapshot = async () => await command({ op: 'foregroundSnapshot' }) as InputSnapshot
  const http = async () => await command({ op: 'nativeHttpSnapshot' }) as HttpSnapshot
  const draft = async () => await command({ op: 'assertMixedAttachments' }) as {
    requestId: string | null
    text: string
    attachments: { type: string; receiptId: string; bytes: number }[]
  }
  const capture = async (name: string) => {
    const image = await command({ op: 'screenshot' })
    if (typeof image !== 'string') throw new Error('Missing Android image budget screenshot')
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
  const pickNewestPhoto = async () => {
    await command({ op: 'openPhotoPicker' })
    await command({ op: 'finishPhotoPick', index: 0 })
  }
  const stagePhoto = async (name: string, data: Buffer) => {
    const staged = await command({ op: 'stageTestPhoto', name, data: data.toString('base64') }) as { uri: string }
    expect(staged.uri, stage).toMatch(PHOTO_URI)
    return staged.uri
  }
  const deletePhoto = async (uri: string) => {
    expect(uri, stage).toMatch(PHOTO_URI)
    await command({ op: 'cleanupTestPhoto', uri })
  }
  try {
    await mkdir(folder, { recursive: true })
    const original = await readFile(IMAGE)
    expect(digest(original)).toBe('b1ff9c8ea3a780bad09b346c423d2d0e46815926879b18e841d928376a946640')
    const oversized = pngWithPadding(original, 1280)
    expect(oversized.length).toBe(1280)
    const text = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    targetSessionId = sessionId
    await scaffold.ctx.sessionController.selectModel({ sessionId, provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' })
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    expect(host.capabilities).toContain('native-remote.http-request-budget.v1')
    expect(host.capabilities).toContain('image-upload.stage.v1')
    driver = await startAndroidCompanionUiDriver(adb, serial, info.port, true)
    await writeFile(join(folder, 'installed-apks.json'), JSON.stringify(driver.installedApks, null, 2) + '\n')
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair-and-open'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    const initial = await snapshot()

    stage = 'preserve-typed-draft'
    const beforeTyping = await settle()
    await command({ op: 'fillPromptDraft', text })
    await command({ op: 'hidePromptKeyboard' })
    const afterTyping = await settle()
    expect(afterTyping.calls).toEqual(beforeTyping.calls)
    const draftBeforeRefusal = (await snapshot()).input.drafts[sessionId]!
    expect(draftBeforeRefusal.text).toBe(text)

    stage = 'local-complete-body-refusal'
    ownedPhotoUri = await stagePhoto(bigName, oversized)
    const encodedArgsBytes = Buffer.byteLength(JSON.stringify({ agentId: sessionId,
      request: { data: oversized.toString('base64'), name: bigName, mediaType: 'image/png' } }))
    expect(oversized.length).toBeLessThan(512 * 1024)
    expect(encodedArgsBytes).toBeLessThanOrEqual(BODY_BUDGET)
    const beforeUpload = await settle()
    await pickNewestPhoto()
    await command({ op: 'assertAttachmentFailure', issue: 'REQUEST_TOO_LARGE' })
    const afterUpload = await settle()
    expect(count('nativeRemote/httpRequestBudget')).toBe(1)
    expect(count('fileUploads/uploadImage')).toBe(0)
    expect(count('session/prompt')).toBe(0)
    // Picker return can refresh the description. Every actual HTTP call must still reach a recorded unary method.
    expect(afterUpload.started - beforeUpload.started).toBe(afterUpload.calls.length - beforeUpload.calls.length)
    expect((await snapshot()).input.drafts[sessionId]).toEqual(draftBeforeRefusal)
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toEqual([])
    await capture('image-budget-refused.png')

    stage = 'explicit-smaller-selection'
    await deletePhoto(ownedPhotoUri)
    ownedPhotoUri = undefined
    ownedPhotoUri = await stagePhoto(smallName, original)
    await pickNewestPhoto()
    await expect.poll(async () => (await draft()).attachments.map(item => item.type), { timeout: 20_000 }).toEqual(['image'])
    await settle()
    expect(count('nativeRemote/httpRequestBudget')).toBe(2)
    expect(count('fileUploads/uploadImage')).toBe(1)
    expect(count('session/prompt')).toBe(0)
    expect(images).toHaveLength(1)
    expect(images[0]!.image).toMatchObject({ mediaType: 'image/png', bytes: original.length, width: 1, height: 1 })
    expect(images[0]!.image.attachmentId).toBe(`sha256:${digest(original)}`)
    const stored = await readFile(scaffold.ctx.attachments.imageHostPath(images[0]!.image)!)
    expect(digest(stored)).toBe(digest(original))
    const ready = await draft()
    expect(ready.text).toBe(text)
    expect(ready.requestId).not.toBe(draftBeforeRefusal.requestId)
    expect(ready.attachments).toMatchObject([
      { type: 'image', receiptId: images[0]!.receiptId, bytes: original.length },
    ])
    await capture('small-image-ready.png')

    stage = 'explicit-send'
    await command({ op: 'submitPromptDraft' })
    await expect.poll(() => events.some(event => event.type === 'turn/end'), { timeout: 60_000 }).toBe(true)
    await command({ op: 'assertNoPendingPrompt' })
    await settle()
    expect(count('session/prompt')).toBe(1)
    expect(count('fileUploads/uploadImage')).toBe(1)
    expect(count('nativeRemote/httpRequestBudget')).toBe(2)
    const userMessages = events.filter(event => event.type === 'user/message').filter(event => event.data.source.kind === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]!.data.source).toMatchObject({ kind: 'user', rpcId: ready.requestId })
    expect(userMessages[0]!.data.content).toEqual([{ type: 'text', text }, { type: 'image', attachment: images[0]!.image }])
    const read = await scaffold.ctx.sessionController.attachment({ sessionId, attachmentId: images[0]!.image.attachmentId })
    expect(digest(Buffer.from(read.data, 'base64'))).toBe(digest(original))
    const final = await snapshot()
    for (const key of ['pid', 'hostId', 'hostKey', 'generation', 'sessionOwner'] as const) expect(final[key]).toBe(initial[key])
    expect(final.input.drafts[sessionId]).toBeUndefined()
    expect(final.input.pending).toEqual({})
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await command({ op: 'assertAttachmentMessage', seq: userMessages[0]!.seq, names: [images[0]!.image.name!] })
    await capture('sent-small-image.png')
    await deletePhoto(ownedPhotoUri)
    ownedPhotoUri = undefined
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-native-image-upload-budget.expected.md', import.meta.url)), [
      '# Android complete image upload request budget', '',
      '- Installed application and instrumentation APK hashes match the tested builds.',
      '- The paired Host advertises the 2048-byte HTTP body budget and staged-image upload through versioned native capabilities.',
      '- A padded real PNG fits the local source limit and the Host budget as encoded arguments, but its complete signed request is refused locally.',
      '- The refusal preserves the typed draft, with zero upload or prompt invocation.',
      '- Completed client HTTP counts match the observed unary calls around each pick, so no extra upload POST reaches the Host.',
      '- After deleting the refused source photo, another explicit Photos selection queries a fresh budget and uploads the small metadata-free PNG.',
      '- Host storage and session-authorized reading return the verified PNG bytes; the image reference keeps raster dimensions and MIME.',
      '- Only the final explicit send creates one durable user message with an ImageBlock after the text.',
      '- The Android process, Host identity, model owner and one device grant remain unchanged.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android image upload budget stage', stage); failures.push(error) }
  finally {
    if (ownedPhotoUri !== undefined && driver !== undefined) {
      await deletePhoto(ownedPhotoUri).catch((error: unknown) => { failures.push(error) })
    }
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await vi.waitFor(() => { expect(inFlight).toBe(0) }).catch((error: unknown) => { failures.push(error) })
    stopEvents()
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android image upload budget acceptance failed')
}, 300_000)
