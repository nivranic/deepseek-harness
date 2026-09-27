/** Native files and durable deliveries share bounded reads from the current real Host namespace. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android previews current file and delivery resources with bounded retry', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const windows: { path: string; offset: number; length: number }[] = []
  const mutations: string[] = []
  let refuseSecondWindow = false
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    if (request.namespace === 'workspaceFiles' && request.method === 'readBytes') {
      const range = request.args.range as { offset: number; length: number }
      windows.push({ path: request.args.path as string, ...range })
      if (refuseSecondWindow && range.offset === 65536) {
        refuseSecondWindow = false
        throw new RemoteError('gateway/internal', 'fixture resource interruption', {})
      }
    }
    if (['prompt', 'create', 'artifact', 'handoff', 'cancel', 'reply'].includes(request.method)) mutations.push(`${request.namespace}/${request.method}`)
    return invoke(request)
  })
  let stage = 'seed'
  try {
    const text = Buffer.from('原生文件与工件共用资源读取。\n第二行。')
    const binary = Buffer.from([0, 255, 13, 42, 128])
    const interrupted = Buffer.alloc(160_000, 0xab)
    const longText = Buffer.alloc(100_000, 0x78)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    const imageBrowser = await chromium.launch(executablePath ? { executablePath } : {})
    let imageData: string[]
    try {
      const page = await imageBrowser.newPage()
      imageData = await page.evaluate(() => [[32, 32], [2500, 2000]].map(([width, height]) => {
        const canvas = document.createElement('canvas')
        canvas.width = width!; canvas.height = height!
        const context = canvas.getContext('2d')!
        context.fillStyle = '#4499dd'; context.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/png').split(',')[1]!
      }))
    } finally { await imageBrowser.close() }
    const picture = Buffer.from(imageData[0]!, 'base64')
    const oversizedImage = Buffer.from(imageData[1]!, 'base64')
    for (const [path, data] of [
      ['空文件.dat', Buffer.alloc(0)], ['报告.txt', text], ['unknown.payload', binary], ['picture.payload', picture],
      ['oversized.png', oversizedImage], ['long.txt', longText], ['large.bin', Buffer.alloc(9 * 1024 * 1024)], ['interrupted.bin', interrupted],
    ] as const) await writeFile(join(scaffold.workspaceCwd, path), data)
    const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
    await scaffold.ctx.sessionController.resolveAgent(sessionId)
    const session = scaffold.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('resource fixture has no live Session')
    session.append('turn/start', { turn: 1 })
    const delivery = session.append('deliverables/presented', { turn: 1, callId: ToolCallId('native-resource-fixture'),
      files: [{ path: '报告.txt', description: '同一份文件的持久交付声明' }] })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(session)
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, stage).toMatchObject({ type: 'ok' })
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
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-resource-adoption/', import.meta.url))
    await mkdir(folder, { recursive: true })
    for (const [path, bytes, tag] of [
      ['空文件.dat', Buffer.alloc(0), 'resource-empty'], ['报告.txt', text, 'resource-text'],
      ['unknown.payload', binary, 'resource-hex'], ['picture.payload', picture, 'resource-image'],
      ['oversized.png', oversizedImage, 'resource-image-unavailable'], ['long.txt', longText, 'resource-text'],
    ] as const) {
      stage = path
      await command({ op: 'previewResource', path })
      expect(await command({ op: 'assertResource', phase: 'READY', tag, ...path === 'long.txt' ? { textChars: 65536 } : {} })).toMatchObject({ received: bytes.length, sha256: digest(bytes) })
      if (path === 'picture.payload' || path === 'oversized.png') {
        await writeFile(`${folder}/${path}.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
      }
      await command({ op: 'closeResource' })
    }
    stage = 'large-prefix'
    await command({ op: 'previewResource', path: 'large.bin' })
    expect(await command({ op: 'assertResource', phase: 'PREVIEW', tag: 'resource-bounded' })).toMatchObject({ received: 256 })
    expect(windows.filter(window => window.path === 'large.bin')).toEqual([{ path: 'large.bin', offset: 0, length: 256 }])
    await command({ op: 'closeResource' })
    stage = 'interrupted-resume'
    refuseSecondWindow = true
    await command({ op: 'previewResource', path: 'interrupted.bin' })
    expect(await command({ op: 'assertResource', phase: 'FAILED', tag: 'resource-failure' })).toMatchObject({ received: 65536 })
    await command({ op: 'retryResource' })
    expect(await command({ op: 'assertResource', phase: 'READY', tag: 'resource-hex' })).toMatchObject({ sha256: digest(interrupted) })
    expect(windows.filter(window => window.path === 'interrupted.bin').map(window => window.offset)).toEqual([0, 65536, 65536, 131072])
    await command({ op: 'closeResource' })
    stage = 'changed-version'
    refuseSecondWindow = true
    await command({ op: 'previewResource', path: 'interrupted.bin' })
    await command({ op: 'assertResource', phase: 'FAILED', tag: 'resource-failure' })
    const changed = Buffer.alloc(160_001, 0xcd)
    await writeFile(join(scaffold.workspaceCwd, 'interrupted.bin'), changed)
    await command({ op: 'retryResource' })
    expect(await command({ op: 'assertResource', phase: 'CHANGED', tag: 'resource-changed' })).toMatchObject({ received: 0, prefix: '' })
    await command({ op: 'restartResource' })
    expect(await command({ op: 'assertResource', phase: 'READY', tag: 'resource-hex' })).toMatchObject({ sha256: digest(changed) })
    await command({ op: 'closeResource' })
    stage = 'durable-delivery'
    await command({ op: 'previewDelivery', seq: delivery.seq, index: 0 })
    expect(await command({ op: 'assertResource', phase: 'READY', tag: 'resource-text' })).toMatchObject({ sha256: digest(text) })
    expect(mutations).toEqual([])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await writeFile(`${folder}/delivery.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
    await command({ op: 'close' }); expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-resource-adoption.expected.md', import.meta.url)), [
      '# Android current file and delivery resources', '',
      '- The installed app reads zero-byte, Unicode text, unknown binary and signature-detected image files from a real Host.',
      '- A complete image above the pixel budget shows an inert byte preview.',
      '- Complete UTF-8 text is retained within the byte budget while its visible text is limited to 65536 characters.',
      '- A nine-MiB file requests only a 256-byte preview and never claims full content.',
      '- A failed 64-KiB window preserves the prefix; explicit retry starts at the missing offset and verifies the complete bytes.',
      '- Changing the file before retry discards all old bytes and requires a fresh read.',
      '- The Artifact pane projects a current durable delivery declaration and opens the same Session-scoped resource reader.',
      '- Previewing redeems no additional grant and calls no prompt, creation, cancellation, reply, retired artifact, or runtime Handoff method.',
      '- This is seeded-history and generated-file transport evidence, not live-model, physical-device or export qualification.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android resource stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android current resource acceptance failed')
}, 240_000)
