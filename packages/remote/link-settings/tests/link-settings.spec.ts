/** Bridge behavior: volatile-config defaults, live application, containment, disposal. */

import { hostname } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings/types'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import LinkSettingsService from '../src/index.ts'

/** Recorded carrier calls, in arrival order. */
interface CarrierCall {
  readonly method: 'name' | 'approval' | 'carrier'
  readonly value: unknown
}

/** Minimal link-access face the bridge touches. */
function provideLinkAccess(ctx: Context, calls: CarrierCall[], failEnable = false): void {
  ctx.provide('linkAccess', {
    setDeviceName: (value: string): void => {
      calls.push({ method: 'name', value })
    },
    setAllowRemoteApproval: (value: boolean): void => {
      calls.push({ method: 'approval', value })
    },
    setCarrierEnabled: (value: boolean): Promise<void> => {
      calls.push({ method: 'carrier', value })
      return failEnable && value ? Promise.reject(new Error('port taken')) : Promise.resolve()
    },
  } as never)
}

/** Let the bridge's fire-and-forget application settle before asserting. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

interface Bridge {
  readonly ctx: Context
  readonly calls: CarrierCall[]
  readonly update: (patch: Record<string, unknown>) => Promise<void>
}

async function mountBridge(failEnable = false): Promise<Bridge> {
  const ctx = new Context()
  const calls: CarrierCall[] = []
  provideLinkAccess(ctx, calls, failEnable)
  const configuration = await liveConfig(ctx, LinkSettingsService)
  return {
    ctx,
    calls,
    update: async (patch) => {
      await configuration.update(patch)
      // One settings-document commit the bridge re-applies after; emitting it
      // here stands in for the settings service's own post-write emission.
      ctx.emit('settings/document-updated', brandString<SettingsNamespace>('link-settings'), 1)
      await settle()
    },
  }
}

describe('link-settings bridge', () => {
  it('applies the configuration defaults once on mount', async () => {
    const { ctx, calls } = await mountBridge()
    try {
      expect(calls).toEqual([
        { method: 'name', value: hostname() },
        { method: 'approval', value: false },
        { method: 'carrier', value: false },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('applies every committed field live, keeping name and approval ahead of the carrier', async () => {
    const { ctx, calls, update } = await mountBridge()
    try {
      await update({ enabled: true, allowRemoteApproval: true, deviceName: 'Studio Desk' })
      expect(calls.slice(3)).toEqual([
        { method: 'name', value: 'Studio Desk' },
        { method: 'approval', value: true },
        { method: 'carrier', value: true },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('maps an empty committed device name back to the OS hostname', async () => {
    const { ctx, calls, update } = await mountBridge()
    try {
      await update({ deviceName: '' })
      expect(calls.at(-3)).toEqual({ method: 'name', value: hostname() })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('contains a carrier bind failure instead of failing the commit', async () => {
    const { ctx, calls, update } = await mountBridge(true)
    try {
      await update({ enabled: true })
      expect(calls.at(-1)).toEqual({ method: 'carrier', value: true })
      // A later commit still applies after the contained failure.
      await update({ enabled: false })
      expect(calls.at(-1)).toEqual({ method: 'carrier', value: false })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('stops re-applying after the bridge disposes', async () => {
    const { ctx, calls } = await mountBridge()
    const before = calls.length
    await ctx.fiber.dispose()
    ctx.emit('settings/document-updated', brandString<SettingsNamespace>('link-settings'), 2)
    await settle()
    expect(calls.length).toBe(before)
  })
})
