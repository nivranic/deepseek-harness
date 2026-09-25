/** Production Kotlin transport against the shipped profile's pinned Native Remote source. */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { launchWebScaffold } from './scaffold.ts'
import { startAndroidGatewayDriver } from './android-gateway-driver.ts'

it.skipIf(!process.env.DSH_ANDROID_JAVA)('pairs the Kotlin client and shares signed Gateway streams over pinned TLS', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidGatewayDriver>> | undefined
  try {
    driver = await startAndroidGatewayDriver(process.env.DSH_ANDROID_JAVA!)
    const { send, next, request: command } = driver
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const issuance = scaffold.ctx.deviceTrust.issuePairing('viewer')
    const payload = { kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issuance.code, expiresAt: issuance.expiresAt, role: issuance.role }
    expect((await command({ op: 'pair', payload: { ...payload, spkiFingerprint: '0'.repeat(64) } })).type).toBe('error')
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(0)
    expect((await command({ op: 'pair', payload })).type).toBe('ok')
    const devices = scaffold.ctx.deviceTrust.listDevices()
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ role: 'viewer', platform: 'android' })
    expect(await command({ op: 'pair', payload })).toMatchObject({ type: 'error', value: { code: 'device/pairing-invalid' } })
    const differentRole = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    expect(await command({ op: 'pair', payload: { ...payload, code: differentRole.code } }))
      .toMatchObject({ type: 'error', value: { code: 'BadWire' } })
    const differentHost = scaffold.ctx.deviceTrust.issuePairing('viewer')
    expect(await command({ op: 'pair', payload: { ...payload, code: differentHost.code, hostId: 'wrong-host' } }))
      .toMatchObject({ type: 'error', value: { code: 'BadWire' } })
    // Failed acknowledgement checks must not replace the previously persisted grant.
    expect((await command({ op: 'restore' })).type).toBe('ok')
    expect((await command({ op: 'call', method: 'session/list', args: { _request: {} } })).type).toBe('ok')
    expect(await command({ op: 'call', method: 'nativeRemote/describe', args: {} }))
      .toMatchObject({ type: 'error', value: { code: 'gateway/permission-denied' } })
    const events = send({ op: 'open', endpoint: '$events', args: {} })
    expect(await next(events)).toMatchObject({ type: 'item', value: { type: 'ready' } })
    const workspace = send({ op: 'open', endpoint: 'workspace/follow', args: {} })
    expect((await next(workspace)).type).toBe('item')
    expect((await command({ op: 'cancel', streamId: workspace })).type).toBe('ok')
    expect((await command({ op: 'call', method: 'session/list', args: { _request: {} } })).type).toBe('ok')
    const liveWorkspace = send({ op: 'open', endpoint: 'workspace/follow', args: {} })
    expect((await next(liveWorkspace)).type).toBe('item')
    await scaffold.ctx.deviceTrust.revokeDevice({ deviceId: devices[0]!.deviceId })
    expect(await next(events)).toMatchObject({ type: 'end' })
    expect(await next(liveWorkspace)).toMatchObject({ type: 'error', value: { code: 'device/already-revoked' } })
    expect(await command({ op: 'call', method: 'session/list', args: { _request: {} } }))
      .toMatchObject({ type: 'error', value: { code: 'device/already-revoked' } })
    expect((await command({ op: 'close' })).type).toBe('ok')
    expect((await command({ op: 'restore' })).type).toBe('ok')
    expect(await command({ op: 'call', method: 'session/list', args: { _request: {} } }))
      .toMatchObject({ type: 'error', value: { code: 'device/already-revoked' } })
    expect((await command({ op: 'close' })).type).toBe('ok')
    const replacement = scaffold.ctx.deviceTrust.issuePairing('viewer')
    expect((await command({ op: 'pair', payload: { ...payload, code: replacement.code } })).type).toBe('ok')
    const active = send({ op: 'open', endpoint: '$events', args: {} })
    expect((await next(active)).type).toBe('item')
    const activeBusiness = send({ op: 'open', endpoint: 'workspace/follow', args: {} })
    expect((await next(activeBusiness)).type).toBe('item')
    expect((await command({ op: 'close' })).type).toBe('ok')
    expect((await next(active)).type).toBe('error')
    expect((await next(activeBusiness)).type).toBe('error')
    expect(await driver.stop()).toBe(0)
  } finally {
    await driver?.kill()
    await scaffold.close()
  }
}, 90_000)
