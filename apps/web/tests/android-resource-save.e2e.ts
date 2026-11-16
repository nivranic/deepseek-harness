/** Native complete resources are saved through the real system picker and checked outside the application. */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const execute = promisify(execFile)
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android saves complete resources and refuses retired picker selections', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: string[] = []
  const owned = new Set<string>()
  const prefix = `dsh-native-save-${randomUUID()}`
  const name = (suffix: string) => `${prefix}-${suffix}`
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const adb = process.env.DSH_ANDROID_ADB!
  const run = (...args: string[]) => execute(adb, ['-s', serial, ...args], { windowsHide: true })
  const downloadPath = (filename: string) => {
    if (!filename.startsWith(`${prefix}-`) || !/^[\p{L}\d.-]+$/u.test(filename)) throw new Error('Unexpected test-owned filename')
    return `/sdcard/Download/${filename}`
  }
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation((request) => {
    calls.push(`${request.namespace}/${request.method}`)
    return invoke(request)
  })
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'SAVE_RESOURCE', title: 'Save resources', turns: 1 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-save-resources')
    const resources = [
      [name('中文.txt'), Buffer.from('保存完整文件。\n第二行。')],
      [name('empty.txt'), Buffer.alloc(0)],
      [name('binary.bin'), Buffer.from([0, 255, 1, 128, 42])],
    ] as const
    for (const [filename, bytes] of resources) await writeFile(join(scaffold.workspaceCwd, filename), bytes)
    const expiredName = name('expired.txt')
    await writeFile(join(scaffold.workspaceCwd, expiredName), 'expired selection')
    await writeFile(join(scaffold.workspaceCwd, name('large.bin')), Buffer.alloc(9 * 1024 * 1024))
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(adb, serial, info.port)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const folder = fileURLToPath(new URL('../../../.artifacts/android-resource-save-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const capture = async (filename: string) => {
      const bytes = await command({ op: 'screenshot' })
      if (typeof bytes !== 'string') throw new Error('Missing application screenshot')
      await writeFile(join(folder, filename), Buffer.from(bytes, 'base64'))
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    for (const [filename, bytes] of resources) {
      stage = filename.endsWith('中文.txt') ? 'unicode-save' : filename.endsWith('empty.txt') ? 'empty-save' : 'binary-save'
      await command({ op: 'previewResource', path: filename })
      await command({ op: 'assertResource', phase: 'READY' })
      const before = calls.length
      const picker = await command({ op: 'openResourceSave' }) as { filename: string; controls: string[]; screenshot: string }
      await writeFile(join(folder, `${stage}-picker.png`), Buffer.from(picker.screenshot, 'base64'))
      expect(picker.filename).toBe(filename)
      owned.add(filename)
      await command({ op: 'finishResourceSave', filename })
      const saved = await run('exec-out', 'base64', downloadPath(filename))
      expect(Buffer.from(saved.stdout, 'base64')).toEqual(bytes)
      expect(calls.slice(before).filter(call => call.startsWith('workspaceFiles/'))).toEqual([])
      await capture(`${stage}-saved.png`)
      await command({ op: 'closeResource' })
    }
    stage = 'cancel-picker'
    await command({ op: 'previewResource', path: resources[0][0] })
    await command({ op: 'assertResource', phase: 'READY' })
    await command({ op: 'openResourceSave' })
    await command({ op: 'cancelResourceSave' })
    await capture('cancelled.png')
    await command({ op: 'closeResource' })
    stage = 'retired-selection'
    await command({ op: 'previewResource', path: expiredName })
    await command({ op: 'assertResource', phase: 'READY' })
    await command({ op: 'openResourceSave' })
    await command({ op: 'retireResourceDuringPicker' })
    owned.add(expiredName)
    await command({ op: 'finishResourceSave', filename: expiredName, expired: true })
    await expect(run('shell', 'test', '-e', downloadPath(expiredName))).rejects.toBeDefined()
    await capture('expired.png')
    stage = 'partial-preview'
    await command({ op: 'previewResource', path: name('large.bin') })
    await command({ op: 'assertResource', phase: 'PREVIEW', tag: 'resource-bounded' })
    await command({ op: 'assertNoResourceSave' })
    await capture('partial-preview.png')
    expect(calls.filter(endpoint => ['prompt', 'cancel', 'create', 'handoff', 'reply'].includes(endpoint.split('/')[1]!))).toEqual([])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-resource-save.expected.md', import.meta.url)), [
      '# Android complete resource saving', '',
      '- The system document picker receives the resource basename and detected MIME type.',
      '- Unicode text, empty files and binary bytes save through the installed Activity.',
      '- Independent filesystem reads match the complete Host bytes; saving dispatches no additional file read.',
      '- Picker cancellation leaves the resource available without writing.',
      '- Retiring the selected resource rejects a late picker result and removes its new empty document.',
      '- A large resource prefix exposes no complete-file save action.',
      '- No Host prompt or other business mutation is sent.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android resource save stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const filename of owned) await run('shell', 'rm', '-f', '--', downloadPath(filename)).catch((error: unknown) => { failures.push(error) })
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android resource save acceptance failed')
}, 180_000)
