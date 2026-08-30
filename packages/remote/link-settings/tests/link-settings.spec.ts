/** Bridge behavior: namespace defaults, live application, containment, disposal. */

import { hostname } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import LinkSettingsService, { REMOTE_SETTINGS_NAMESPACE } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

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

async function mountBridge(failEnable = false): Promise<{ ctx: Context; calls: CarrierCall[] }> {
  const ctx = new Context()
  const calls: CarrierCall[] = []
  provideLinkAccess(ctx, calls, failEnable)
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin(LinkSettingsService).await()
  return { ctx, calls }
}

describe('link-settings bridge', () => {
  it('registers the remote namespace and applies its defaults once on mount', async () => {
    const { ctx, calls } = await mountBridge()
    try {
      expect(ctx.settings.get(settingsNamespace(REMOTE_SETTINGS_NAMESPACE)))
        .toEqual({ enabled: false, allowRemoteApproval: false, deviceName: hostname() })
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
    const { ctx, calls } = await mountBridge()
    try {
      await ctx.settings.update(settingsNamespace(REMOTE_SETTINGS_NAMESPACE), {
        enabled: true,
        allowRemoteApproval: true,
        deviceName: 'Studio Desk',
      })
      await settle()
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
    const { ctx, calls } = await mountBridge()
    try {
      await ctx.settings.update(settingsNamespace(REMOTE_SETTINGS_NAMESPACE), { deviceName: '' })
      await settle()
      expect(calls.at(-3)).toEqual({ method: 'name', value: hostname() })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('contains a carrier bind failure instead of failing the commit', async () => {
    const { ctx, calls } = await mountBridge(true)
    try {
      await ctx.settings.update(settingsNamespace(REMOTE_SETTINGS_NAMESPACE), { enabled: true })
      await settle()
      expect(calls.at(-1)).toEqual({ method: 'carrier', value: true })
      // A later commit still applies after the contained failure.
      await ctx.settings.update(settingsNamespace(REMOTE_SETTINGS_NAMESPACE), { enabled: false })
      await settle()
      expect(calls.at(-1)).toEqual({ method: 'carrier', value: false })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('unregisters the namespace on disposal so later commits fail loud', async () => {
    const ctx = new Context()
    const calls: CarrierCall[] = []
    provideLinkAccess(ctx, calls)
    await ctx.plugin(MemorySettings).await()
    const bridge = ctx.plugin(LinkSettingsService)
    await bridge.await()
    await bridge.dispose()
    await expect(ctx.settings.update(settingsNamespace(REMOTE_SETTINGS_NAMESPACE), { enabled: true }))
      .rejects.toThrow(/not registered/u)
    expect(calls.filter(call => call.method === 'carrier' && call.value === true)).toEqual([])
    await ctx.fiber.dispose()
  })
})
