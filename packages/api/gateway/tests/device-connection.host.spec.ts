/** Signed admission parsing, revocation and device carrier ownership. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { DeviceId, type DeviceAdmission, type DeviceView } from '@deepseek-ai/dsh-api-device-trust'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { Remote, remoteErrorOf, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createDeviceConnection, DeviceConnections, deviceHasPermission, installDevicePolicy } from '../src/device-connection.ts'
import type { RemoteStreamOpener } from '../src/stream-server.ts'

const DEVICE = DeviceId('device-fixture')
const proof = { deviceId: DEVICE, timestamp: 1, nonce: 'nonce', signature: 'signature' }
const admitted: DeviceAdmission = {
  deviceId: DEVICE, deviceName: 'fixture', role: 'viewer', permissions: ['view'], admittedAt: 1,
}
const window = { maxBytes: 1024, frameOverheadBytes: 32 }

class UnclassifiedRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'unclassified', { capabilities: [{ id: 'unclassified.read.v1', methods: ['read'] }] })
  }

  @Remote
  read(): string { return 'unclassified' }
}

function fixture(withTrust = true) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const grants: DeviceView[] = [{ deviceId: DEVICE, deviceName: 'fixture', role: 'viewer', keyFingerprint: 'key', pairedAt: 1 }]
  const admit = vi.fn(async (): Promise<DeviceAdmission> => admitted)
  if (withTrust) ctx.provide('deviceTrust', { admitDevice: admit, listDevices: () => grants } as never)
  const rpc = vi.fn<ConnectionRpcHandler>(async () => ({ ok: true, value: 'received' }))
  const open = vi.fn<RemoteStreamOpener>(async () => (async function* () { yield 'received' })())
  const connections = new DeviceConnections()
  const carrier = createDeviceConnection(ctx, rpc, open, error => ({
    code: remoteErrorOf(error)?.code ?? 'gateway/internal', message: 'fixture failure', details: {},
  }), connections)
  return { ctx, grants, admit, rpc, open, connections, carrier }
}

it('counts physical carriers across logical streams and tolerates stale releases', () => {
  const connections = new DeviceConnections()
  const first = { terminate: vi.fn() }
  const second = { terminate: vi.fn() }
  const releaseFirst = connections.bind(DEVICE, first)
  const releaseAgain = connections.bind(DEVICE, first)
  const releaseSecond = connections.bind(DEVICE, second)
  releaseFirst()
  expect(connections.terminate(DEVICE)).toBe(2)
  expect(first.terminate).toHaveBeenCalledOnce()
  expect(second.terminate).toHaveBeenCalledOnce()
  releaseAgain()
  releaseSecond()
  expect(connections.terminate(DEVICE)).toBe(0)
  const release = connections.bind(DEVICE, first)
  const remaining = connections.bind(DEVICE, second)
  release()
  release()
  remaining()
  expect(connections.terminate(DEVICE)).toBe(0)
})

it.each([
  { device: null }, { device: [] }, { device: {} },
  { device: { ...proof, extra: true } }, { device: { ...proof, deviceId: '' } },
  { device: { ...proof, timestamp: '1' } }, { device: { ...proof, timestamp: 1.5 } },
  { device: { ...proof, nonce: '' } }, { device: { ...proof, signature: '' } },
])('rejects malformed signed admission $device before dispatch', async ({ device }) => {
  const { carrier, rpc, admit } = fixture()
  await expect(carrier.rpc('fixture/read', { apiProtocolVersion: 2, args: {}, device }, new AbortController().signal, carrier.peer))
    .resolves.toMatchObject({ ok: false, error: { code: 'gateway/arguments-invalid' } })
  expect(rpc).not.toHaveBeenCalled()
  expect(admit).not.toHaveBeenCalled()
})

it('refuses diagnostics-only calls and duplicate event admission', async () => {
  const { carrier, rpc } = fixture()
  const signal = new AbortController().signal
  await expect(carrier.rpc('fixture/read', { apiProtocolVersion: 0, args: {}, device: proof }, signal, carrier.peer))
    .resolves.toMatchObject({ ok: false, error: { code: 'gateway/protocol-unsupported' } })
  await expect(carrier.rpc('$events', { apiProtocolVersion: 2, args: { device: proof }, device: proof }, signal, carrier.peer))
    .resolves.toMatchObject({ ok: false, error: { code: 'gateway/arguments-invalid' } })
  expect(rpc).not.toHaveBeenCalled()
})

it('reports unavailable trust and missing identity independently', async () => {
  const { carrier } = fixture(false)
  const signal = new AbortController().signal
  await expect(carrier.rpc('fixture/read', { apiProtocolVersion: 2, args: {} }, signal, carrier.peer))
    .resolves.toMatchObject({ ok: false, error: { code: 'gateway/permission-denied' } })
  await expect(carrier.rpc('fixture/read', { apiProtocolVersion: 2, args: {}, device: proof }, signal, carrier.peer))
    .resolves.toMatchObject({ ok: false, error: { code: 'gateway/service-unavailable' } })
})

it('releases unary admission peers and removes embedded legacy event proof', async () => {
  const { carrier, rpc } = fixture()
  await expect(carrier.rpc('$events', { args: { device: proof, retained: true } }, new AbortController().signal, carrier.peer))
    .resolves.toEqual({ ok: true, value: 'received' })
  const call = rpc.mock.calls[0]!
  expect(call[1]).toEqual({ args: { retained: true } })
  expect(call[3].principal).toEqual({ kind: 'device', deviceId: DEVICE })
  expect(call[3].signal.aborted).toBe(true)
  expect(carrier.peer.signal.aborted).toBe(false)
})

it('cancels matching revocation during admission and ignores other device revocations', async () => {
  const { ctx, carrier, rpc, admit } = fixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<DeviceAdmission>()
  admit.mockImplementationOnce(() => { entered.resolve(undefined); return release.promise })
  const calling = carrier.rpc('fixture/read', { apiProtocolVersion: 2, args: {}, device: proof },
    new AbortController().signal, carrier.peer)
  try {
    await entered.promise
    ctx.emit('deviceTrust/grantsRevoked', { revokedAt: 2, deviceIds: [DeviceId('other')] })
    ctx.emit('deviceTrust/grantsRevoked', { revokedAt: 3, deviceIds: [DEVICE] })
    release.resolve(admitted)
    await expect(calling).resolves.toMatchObject({ ok: false, error: { code: 'device/already-revoked' } })
    expect(rpc).not.toHaveBeenCalled()
  } finally {
    release.resolve(admitted)
    await calling
  }
})

it.each([false, true])('disposes a stream peer after logical cancellation, physical carrier=%s', async (physical) => {
  const { carrier, connections, open } = fixture()
  const control = new AbortController()
  const connection = physical ? { terminate: vi.fn() } : undefined
  open.mockImplementationOnce(async () => (async function* () {
    yield 'first'
    control.abort(new Error('logical stream stopped'))
  })())
  const stream = await carrier.stream.open('fixture/read', { apiProtocolVersion: 2, args: {}, device: proof },
    (async function* () {})(), carrier.peer, control, window, connection)
  const iterator = stream[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ done: false, value: 'first' })
  await expect(iterator.next()).rejects.toThrow('logical stream stopped')
  expect(open.mock.calls[0]?.[3].signal.aborted).toBe(true)
  expect(connections.terminate(DEVICE)).toBe(0)
  if (connection !== undefined) expect(connection.terminate).not.toHaveBeenCalled()
})

it('checks current grants for forwarded permissions and Host event bindings', async () => {
  const { ctx, grants, carrier } = fixture()
  new UnclassifiedRemote(ctx)
  ctx.provide('scalarFixture', 1)
  ctx.provide('nullFixture', null)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin({ inject: ['remoteAccess'], apply: installDevicePolicy })
  const principal = { kind: 'device' as const, deviceId: DEVICE }
  expect(deviceHasPermission(ctx, principal, 'view')).toBe(true)
  const decision = () => ctx.remoteAccess.decide({ principal, action: 'event:fixture/notice', resources: [{ kind: 'host' }], args: {} })
  await vi.waitFor(() => { expect(decision()).toEqual({ kind: 'allow' }) })
  expect(ctx.remoteAccess.decide({ principal, action: 'unclassified/read', resources: [{ kind: 'host' }], args: {} }))
    .toMatchObject({ kind: 'deny' })
  expect(deviceHasPermission(ctx, principal, 'view')).toBe(true)
  expect(deviceHasPermission(ctx, carrier.peer.principal, 'view')).toBe(false)
  grants.splice(0)
  expect(deviceHasPermission(ctx, principal, 'view')).toBe(false)
  expect(decision()).toMatchObject({ kind: 'deny' })
})
