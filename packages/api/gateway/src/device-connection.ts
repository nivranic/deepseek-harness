/** Signed native admission and device role bindings over the shared Peer dispatcher. */

import type { Context } from '@deepseek-ai/cordis'
import { Peer, type ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { DEVICE_ROLE_PERMISSIONS } from '@deepseek-ai/dsh-api-device-trust'
import type { AdmitDeviceRequest, DeviceId } from '@deepseek-ai/dsh-api-device-trust/types'
import type { RemoteAccessAction } from '@deepseek-ai/dsh-api-remote-access'
import {
  RemoteError,
  type Principal,
  type RemoteCapabilityPermission,
  type TypertGatewayBinding,
} from '@deepseek-ai/dsh-typert-protocol'
import { decodeRemoteRequest, DIAGNOSTICS_ONLY_ENDPOINTS, SUPPORTED_REMOTE_PROTOCOL_VERSIONS } from './protocol.ts'
import type { RemoteStreamConnectionHandle, RemoteStreamOpener } from './stream-server.ts'
import type { TypertGatewayDeviceConnection, TypertGatewayWireStream } from './types.ts'

/** Gateway-owned counts of admitted logical streams per device and physical carrier. */
export class DeviceConnections {
  private readonly devices = new Map<DeviceId, Map<RemoteStreamConnectionHandle, number>>()

  /**
   * Retain a physical carrier until this admitted stream ends.
   * @param deviceId - verified device identity.
   * @param connection - physical carrier supplied by the mux.
   * @returns disposer releasing this stream's claim.
   */
  bind(deviceId: DeviceId, connection: RemoteStreamConnectionHandle): () => void {
    let connections = this.devices.get(deviceId)
    if (connections === undefined) this.devices.set(deviceId, connections = new Map<RemoteStreamConnectionHandle, number>())
    connections.set(connection, (connections.get(connection) ?? 0) + 1)
    return () => {
      if (this.devices.get(deviceId) !== connections) return
      const count = connections.get(connection) ?? 0
      if (count <= 1) connections.delete(connection)
      else connections.set(connection, count - 1)
      if (connections.size === 0) this.devices.delete(deviceId)
    }
  }

  /**
   * Destroy the device's active carriers; admission remains unchanged.
   * @param deviceId - device whose transport is being reset.
   * @returns number of distinct carriers destroyed.
   */
  terminate(deviceId: DeviceId): number {
    const connections = this.devices.get(deviceId)
    if (connections === undefined) return 0
    this.devices.delete(deviceId)
    for (const connection of connections.keys()) connection.terminate()
    return connections.size
  }
}

/**
 * Register device policies while Device Trust is available. Bindings are read
 * in the dispatching Context so an isolated provider retains its own declarations.
 * @param ctx - Gateway owner with Remote Access.
 */
export function installDevicePolicy(ctx: Context): void {
  ctx.inject(['deviceTrust'], (policyCtx) => {
    policyCtx.remoteAccess.registerPolicy('device-pairing', {
      bindings: () => [{
        role: { name: 'pairing', resource: 'global', actions: ['deviceTrust/redeemPairing'] },
        resource: { kind: 'global' },
      }],
    })
    policyCtx.remoteAccess.registerPolicy('device', {
      bindings: (principal, context, action) => {
        const grant = context.get('deviceTrust')?.listDevices().find(device => device.deviceId === principal.deviceId)
        if (grant === undefined || grant.revokedAt !== undefined) return []
        const permissions = DEVICE_ROLE_PERMISSIONS[grant.role]
        const actions = deviceActions(context, permissions)
        // Forwarded notifications are Host-selected; view grants their complete payload across the Host.
        if (action?.startsWith('event:') && permissions.includes('view')) actions.push(action)
        return [{
          role: { name: `device-${grant.role}`, resource: 'host', actions },
          resource: { kind: 'host' },
        }]
      },
    })
    policyCtx.on('deviceTrust/grantsRevoked', ({ deviceIds }) => {
      for (const deviceId of deviceIds) policyCtx.remoteAccess.invalidate({ kind: 'device', deviceId })
    })
    policyCtx.on('internal/service', () => { policyCtx.remoteAccess.invalidate() })
  })
}

/**
 * Read a device's current role for a forwarded interaction.
 * @param ctx - dispatching Context with the owning Device Trust service.
 * @param principal - caller or event recipient; non-device principals are refused.
 * @param permission - application-declared response permission.
 * @returns whether the active grant currently holds that permission.
 */
export function deviceHasPermission(ctx: Context, principal: Principal, permission: RemoteCapabilityPermission): boolean {
  if (principal.kind !== 'device') return false
  const grant = ctx.get('deviceTrust')?.listDevices().find(device => device.deviceId === principal.deviceId)
  return grant !== undefined && grant.revokedAt === undefined && DEVICE_ROLE_PERMISSIONS[grant.role].includes(permission)
}

function deviceActions(ctx: Context, permissions: readonly RemoteCapabilityPermission[]): RemoteAccessAction[] {
  const actions = new Set<RemoteAccessAction>()
  for (const [key, definition] of Object.entries(ctx.reflect.props)) {
    if (definition.type !== 'service') continue
    const receiver: unknown = ctx.get(key)
    if (typeof receiver !== 'object' || receiver === null) continue
    const binding = Reflect.get(receiver, 'typertRemote') as TypertGatewayBinding | undefined
    if (binding === undefined) continue
    for (const capability of binding.capabilities ?? []) {
      if (capability.requiredPermission === undefined || !permissions.includes(capability.requiredPermission)) continue
      for (const method of capability.methods) actions.add(`${binding.namespace}/${method}`)
    }
  }
  return [...actions]
}

/**
 * Build callbacks whose signed requests create device Peers only after admission.
 * The unauthenticated carrier Peer has no device authority.
 * @param ctx - caller's service scope; owns carrier and admitted Peers.
 * @param rpc - shared Gateway unary dispatcher.
 * @param open - shared Gateway stream dispatcher.
 * @param failure - shared structured failure mapper.
 * @param connections - Gateway-owned admitted physical carriers.
 * @returns native carrier callbacks and their unauthenticated lifetime Peer.
 */
export function createDeviceConnection(
  ctx: Context,
  rpc: ConnectionRpcHandler,
  open: RemoteStreamOpener,
  failure: TypertGatewayWireStream['failure'],
  connections: DeviceConnections,
): TypertGatewayDeviceConnection {
  const carrier = new Peer(ctx, { principal: { kind: 'device-pairing' }, interactions: 'none' })
  const admit = async (endpoint: string, payload: unknown, signal: AbortSignal, pairing: boolean, control: AbortController) => {
    carrier.signal.throwIfAborted()
    signal.throwIfAborted()
    const decoded = decodeRemoteRequest(endpoint, payload)
    if (decoded.diagnosticsOnly && !DIAGNOSTICS_ONLY_ENDPOINTS.has(endpoint)) {
      throw new RemoteError('gateway/protocol-unsupported', 'This protocol permits only Host discovery', {
        endpoint, supportedApiProtocolVersions: [...SUPPORTED_REMOTE_PROTOCOL_VERSIONS],
      })
    }
    let request = decoded.payload
    let device = decoded.device
    // Frozen native event clients place their signed admission inside the empty event args.
    if (endpoint === '$events' && typeof request === 'object' && request !== null) {
      const args: unknown = Reflect.get(request, 'args')
      if (typeof args === 'object' && args !== null && Object.hasOwn(args, 'device')) {
        if (device !== undefined) throw new RemoteError('gateway/arguments-invalid', 'Device admission is duplicated', { endpoint, field: 'device' })
        device = Reflect.get(args, 'device')
        request = { ...request, args: Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'device')) }
      }
    }
    if (device === undefined) {
      if (pairing && endpoint === 'deviceTrust/redeemPairing') return { peer: carrier, payload: decoded.payload, release: () => {} }
      throw new RemoteError('gateway/permission-denied', 'Signed device identity is required', { endpoint, reason: 'device-identity' })
    }
    const admission = parseAdmission(endpoint, device)
    const trust = ctx.get('deviceTrust')
    if (trust === undefined) throw new RemoteError('gateway/service-unavailable', 'Device Trust is unavailable', { endpoint })
    const release = carrier.ctx.on('deviceTrust/grantsRevoked', ({ deviceIds, revokedAt }) => {
      if (deviceIds.includes(admission.deviceId)) {
        control.abort(new RemoteError('device/already-revoked', 'Device access was revoked', { deviceId: admission.deviceId, revokedAt }))
      }
    })
    try {
      await trust.admitDevice(admission)
      signal.throwIfAborted()
      carrier.signal.throwIfAborted()
      return { peer: new Peer(carrier.ctx, { principal: { kind: 'device', deviceId: admission.deviceId } }), payload: request, release }
    } catch (error) {
      release()
      throw error
    }
  }
  return {
    peer: carrier,
    rpc: async (endpoint, payload, signal) => {
      let peer: Peer | undefined
      let release: (() => void) | undefined
      const control = new AbortController()
      const lifetime = AbortSignal.any([signal, control.signal, carrier.signal])
      try {
        const admitted = await admit(endpoint, payload, lifetime, true, control)
        peer = admitted.peer
        release = admitted.release
        return await rpc(endpoint, admitted.payload, AbortSignal.any([lifetime, peer.signal]), peer)
      } catch (error) {
        return { ok: false, error: failure(error) }
      } finally {
        release?.()
        if (peer !== undefined && peer !== carrier) await peer.dispose()
      }
    },
    stream: {
      failure,
      open: async (endpoint, payload, uplink, _carrier, control, window, connection) => {
        const admitted = await admit(endpoint, payload, control.signal, false, control)
        const peer = admitted.peer
        const unbind = connection !== undefined && peer.principal.kind === 'device'
          ? connections.bind(peer.principal.deviceId, connection) : undefined
        async function* values(): AsyncIterable<unknown> {
          try {
            const source = await open(endpoint, admitted.payload, uplink, peer, control, window)
            for await (const value of source) {
              control.signal.throwIfAborted()
              yield value
            }
            control.signal.throwIfAborted()
          } finally {
            unbind?.()
            admitted.release()
            await peer.dispose()
          }
        }
        return values()
      },
    },
  }
}

function parseAdmission(endpoint: string, value: unknown): AdmitDeviceRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RemoteError('gateway/arguments-invalid', 'Device admission must be an object', { endpoint, field: 'device' })
  }
  const deviceId: unknown = Reflect.get(value, 'deviceId')
  const timestamp: unknown = Reflect.get(value, 'timestamp')
  const nonce: unknown = Reflect.get(value, 'nonce')
  const signature: unknown = Reflect.get(value, 'signature')
  if (Reflect.ownKeys(value).length !== 4 || typeof deviceId !== 'string' || deviceId.length === 0
    || typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)
    || typeof nonce !== 'string' || nonce.length === 0 || typeof signature !== 'string' || signature.length === 0) {
    throw new RemoteError('gateway/arguments-invalid', 'Device admission fields are invalid', { endpoint, field: 'device' })
  }
  return { deviceId: deviceId as AdmitDeviceRequest['deviceId'], timestamp, nonce, signature }
}
