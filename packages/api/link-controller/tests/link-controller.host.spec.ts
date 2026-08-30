/** Host-owner behavior: status projection, pairing refusal mapping, device views. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { LinkCarrierStatus, LinkPairingPayload } from '@deepseek-ai/dsh-link-access/protocol'
import type { PairedDevice } from '@deepseek-ai/dsh-device-trust'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { LinkController } from '../src/index.ts'

const PAIRING: LinkPairingPayload = {
  v: 1,
  kind: 'dsh-link-pairing',
  hostId: 'host-1',
  hostName: 'Studio Desk',
  endpoint: 'https://192.168.1.4:4931',
  spkiFingerprint: 'ab'.repeat(32),
  code: 'pair-once',
  expiresAt: 1_800_000_000_000,
}

const DEVICES: PairedDevice[] = [
  {
    deviceId: 'device-1' as PairedDevice['deviceId'],
    name: 'iPhone',
    publicKeySpki: 'c2VjcmV0',
    role: 'controller',
    createdAt: 100,
    lastSeenAt: 200,
    revokedAt: undefined,
  },
  {
    deviceId: 'device-2' as PairedDevice['deviceId'],
    name: 'iPad',
    publicKeySpki: 'c2VjcmV0Mg',
    role: 'observer',
    createdAt: 300,
    lastSeenAt: undefined,
    revokedAt: 400,
  },
]

/** Link-carrier face the controller touches, recording revocations. */
function mountController(options: {
  readonly carrier?: LinkCarrierStatus
  readonly pairingError?: Error
  readonly devices?: readonly PairedDevice[]
} = {}): { ctx: Context; controller: LinkController; revoked: string[] } {
  const ctx = new Context()
  const revoked: string[] = []
  ctx.provide('linkAccess', {
    carrierStatus: (): Promise<LinkCarrierStatus> =>
      Promise.resolve(options.carrier ?? { listening: false }),
    createPairing: (): Promise<LinkPairingPayload> =>
      options.pairingError === undefined
        ? Promise.resolve(PAIRING)
        : Promise.reject(options.pairingError),
    trustedDevices: (): Promise<readonly PairedDevice[]> =>
      Promise.resolve(options.devices ?? []),
    revokeDevice: (deviceId: PairedDevice['deviceId']): Promise<PairedDevice | undefined> => {
      revoked.push(deviceId)
      const match = DEVICES.find(device => device.deviceId === deviceId)
      return Promise.resolve(match === undefined ? undefined : { ...match, revokedAt: 500 })
    },
    deviceName: (): string => 'Studio Desk',
    isRemoteApprovalAllowed: (): boolean => true,
  } as never)
  const controller = new LinkController(ctx)
  return { ctx, controller, revoked }
}

function failureOf(promise: Promise<unknown>): Promise<TypertRemoteFailure> {
  return promise.then(() => {
    throw new Error('expected the call to reject')
  }, (error: unknown) => {
    expect(error).toBeInstanceOf(TypertRemoteFailure)
    return error as TypertRemoteFailure
  })
}

describe('api-link-controller host owner', () => {
  it('projects carrier status, identity, and the device count', async () => {
    const { ctx, controller } = mountController({
      carrier: { listening: true, endpoint: PAIRING.endpoint, spkiFingerprint: PAIRING.spkiFingerprint },
      devices: DEVICES,
    })
    try {
      await expect(controller.status()).resolves.toEqual({
        listening: true,
        endpoint: PAIRING.endpoint,
        spkiFingerprint: PAIRING.spkiFingerprint,
        hostName: 'Studio Desk',
        allowRemoteApproval: true,
        deviceCount: 2,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('carries bind diagnostics while stopped', async () => {
    const { ctx, controller } = mountController({ carrier: { listening: false, bindError: 'EADDRINUSE listen' } })
    try {
      await expect(controller.status()).resolves.toMatchObject({ listening: false, bindError: 'EADDRINUSE listen' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serves pairing payloads and maps a stopped carrier to link-disabled', async () => {
    const stopped = mountController({ pairingError: new Error('link access: carrier is disabled; enable it before pairing') })
    try {
      const refusal = await failureOf(stopped.controller.createPairing())
      expect(refusal.failure.code).toBe('link-disabled')
    } finally {
      await stopped.ctx.fiber.dispose()
    }

    const working = mountController()
    try {
      await expect(working.controller.createPairing()).resolves.toEqual(PAIRING)
    } finally {
      await working.ctx.fiber.dispose()
    }
  })

  it('lists device rows without public keys and revokes by id', async () => {
    const { ctx, controller, revoked } = mountController({ devices: DEVICES })
    try {
      const rows = await controller.devices()
      expect(rows).toEqual([
        { deviceId: 'device-1', name: 'iPhone', role: 'controller', createdAt: 100, lastSeenAt: 200 },
        { deviceId: 'device-2', name: 'iPad', role: 'observer', createdAt: 300, revokedAt: 400 },
      ])
      expect(JSON.stringify(rows)).not.toContain('publicKeySpki')
      expect(JSON.stringify(rows)).not.toContain('c2VjcmV0')

      await expect(controller.revokeDevice('device-1')).resolves.toMatchObject({
        deviceId: 'device-1',
        revokedAt: 500,
      })
      expect(revoked).toEqual(['device-1'])
      await expect(controller.revokeDevice('missing')).resolves.toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses an empty revoke id and a missing carrier', async () => {
    const { ctx, controller } = mountController()
    try {
      const empty = await failureOf(controller.revokeDevice(''))
      expect(empty.failure.code).toBe('bad-request')
    } finally {
      await ctx.fiber.dispose()
    }

    const bare = new Context()
    const bareController = new LinkController(bare)
    try {
      const unavailable = await failureOf(bareController.status())
      expect(unavailable.failure.code).toBe('link-unavailable')
    } finally {
      await bare.fiber.dispose()
    }
  })
})
