/** Production Kotlin transport against the shipped profile's pinned Native Remote source. */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { launchWebScaffold } from './scaffold.ts'

interface DriverFrame { id: string; type: string; value: unknown }

it.skipIf(!process.env.DSH_ANDROID_JAVA)('pairs the Kotlin client and shares signed Gateway streams over pinned TLS', async () => {
  const classpath = await readFile(new URL('../../android/core/build/native-gateway-classpath.txt', import.meta.url), 'utf8')
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  const child = spawn(process.env.DSH_ANDROID_JAVA!, ['-cp', classpath, 'ai.deepseek.dsh.gateway.NativeGatewayDriver'], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  const lines = createInterface({ input: child.stdout })
  const frames: DriverFrame[] = []
  const pending = new Map<string, { resolve: (value: DriverFrame) => void; reject: (error: Error) => void }>()
  let failure: Error | undefined
  let sequence = 0
  child.stderr.resume()
  const fail = (error: Error) => {
    failure = error
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  child.on('error', () => { fail(new Error('Kotlin driver failed to launch')) })
  const exited = new Promise<number | null>(resolve => child.once('close', (code) => {
    fail(new Error(`Kotlin driver exited: ${String(code)}`)); resolve(code)
  }))
  lines.on('line', (line) => {
    try {
      const value = JSON.parse(line) as DriverFrame
      const request = pending.get(value.id)
      if (request) { pending.delete(value.id); request.resolve(value) }
      else frames.push(value)
    } catch { fail(new Error('Kotlin driver emitted invalid JSON')) }
  })
  const next = (id: string): Promise<DriverFrame> => {
    const index = frames.findIndex(value => value.id === id)
    if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]!)
    if (failure) return Promise.reject(failure)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Kotlin driver response ${id} timed out`)) }, 15_000)
      pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value) },
        reject: (error) => { clearTimeout(timeout); reject(error) },
      })
    })
  }
  const send = (command: object): string => {
    const id = String(++sequence)
    child.stdin.write(JSON.stringify({ ...command, id }) + '\n')
    return id
  }
  const command = (value: object) => next(send(value))
  try {
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
    child.stdin.end()
    expect(await exited).toBe(0)
  } finally {
    lines.close()
    child.stdin.end()
    if (child.exitCode === null) child.kill()
    await exited
    await scaffold.close()
  }
}, 90_000)
