/** Installed Android capability details project read-only negotiation from the current real Host. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android capability details retain observations through refusal and recover explicitly', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const mutations: string[] = []
  let negotiations = 0
  let refuse = false
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const spy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    if (request.namespace === 'host' && request.method === 'negotiate') {
      negotiations++
      if (refuse) throw new RemoteError('gateway/permission-denied', 'PRIVATE_CAPABILITY_REFUSAL', {
        endpoint: 'host/negotiate', reason: 'device-identity',
      })
    }
    if (['prompt', 'create', 'handoff', 'cancel', 'reply'].includes(request.method)) mutations.push(`${request.namespace}/${request.method}`)
    return invoke(request)
  })
  let stage = 'pair'
  try {
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result.type, stage).toBe('ok')
      return result.value
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    const output = fileURLToPath(new URL('../../../.artifacts/android-capability-presentation-ui/', import.meta.url))
    await mkdir(output, { recursive: true })
    const details = async (request: object) => {
      const value = await command(request)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Capability response must be an object')
      return value as Record<string, unknown>
    }
    const saveScreenshot = async (name: string, value: unknown) => {
      if (typeof value !== 'string') throw new Error('Capability screenshot must be base64 text')
      await writeFile(join(output, name), Buffer.from(value, 'base64'))
    }
    stage = 'available-details'
    const available = await details({ op: 'capabilityDetails', state: 'available', screenshot: true })
    expect(available.texts).toContain('跟随会话：已声明支持')
    expect(available.texts).toContain('配对时角色：协作者')
    expect(available.texts).toContain('API 协议：2；Session 格式：3')
    expect(available.texts).toContain('能力表示 Host 声明支持的接口，不代表当前权限、在线状态或操作一定成功。')
    await saveScreenshot('available.png', available.screenshot)
    const before = negotiations
    await command({ op: 'closeCapabilityDetails' })
    await command({ op: 'capabilityDetails', state: 'available' })
    expect(negotiations).toBe(before)
    stage = 'refused-refresh'
    refuse = true
    const failed = await details({ op: 'capabilityDetails', state: 'failed', refresh: true, screenshot: true })
    expect(failed.texts).toContain('查询失败，保留最近一次成功观察。请检查连接后刷新。')
    expect(failed.texts).toContain('跟随会话：已声明支持')
    expect(JSON.stringify(failed.texts)).not.toContain('PRIVATE_CAPABILITY_REFUSAL')
    expect(negotiations).toBe(before + 1)
    await saveScreenshot('failed.png', failed.screenshot)
    stage = 'recovered-refresh'
    refuse = false
    const recovered = await details({ op: 'capabilityDetails', state: 'available', refresh: true })
    expect(recovered.texts).toContain('最近一次查询成功')
    expect(recovered.texts).not.toContain('查询失败，保留最近一次成功观察。请检查连接后刷新。')
    expect(negotiations).toBe(before + 2)
    expect(mutations).toEqual([])
    await command({ op: 'closeCapabilityDetails' })
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-capability-presentation.expected.md', import.meta.url)), [
      '# Android capability observations', '',
      '- The installed Activity displays the current real Host negotiation through its foreground observer.',
      '- Details label pairing-time role and distinguish API protocol 2 from Session format 3.',
      '- Known advertised capabilities are observations, not current permissions or connection health.',
      '- Closing and reopening details performs no negotiation or business mutation.',
      '- An explicit refused refresh retains the last successful facts with fixed user copy; remote exception text stays absent.',
      '- One explicit recovery refresh clears the failure and displays the successful observation.',
      '- This scenario does not qualify full capability coverage, permission-based action gating or physical devices.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android capability stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    spy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android capability presentation failed')
}, 180_000)
