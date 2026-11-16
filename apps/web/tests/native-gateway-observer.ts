/** Native carrier observation installed before the listener captures its Gateway callbacks. */
import type { TypertGatewayDeviceConnection } from '@deepseek-ai/dsh-api-gateway'
import { vi } from 'vitest'
import { launchWebScaffold, type LaunchOptions, type WebScaffold } from './scaffold.ts'
import { requireBuilt } from './support.ts'

/** Mutable callbacks reached by the scenario's native listener. */
export interface NativeGatewayObservation {
  rpc: TypertGatewayDeviceConnection['rpc']
  open: TypertGatewayDeviceConnection['stream']['open']
}

/** The normal Web scaffold with its native carrier callbacks exposed to the scenario. */
export interface ObservedNativeScaffold extends WebScaffold {
  nativeGateway: NativeGatewayObservation
}

/**
 * Boot the shipped Web tree while observing its native carrier callback registration.
 * @param options - Normal Web scaffold composition and replay options.
 * @returns The running scaffold and callbacks for its single native listener.
 */
export async function launchObservedNativeScaffold(options: LaunchOptions): Promise<ObservedNativeScaffold> {
  const { default: Gateway } = requireBuilt('@deepseek-ai/dsh-api-gateway') as typeof import('@deepseek-ai/dsh-api-gateway')
  // oxlint-disable-next-line typescript/unbound-method -- Called below with the accepting Gateway as its receiver.
  const createConnection = Gateway.prototype.createDeviceConnection
  const observations: NativeGatewayObservation[] = []
  const spy = vi.spyOn(Gateway.prototype, 'createDeviceConnection').mockImplementation(function (this: InstanceType<typeof Gateway>) {
    const adapter = createConnection.call(this)
    const observation = { rpc: adapter.rpc, open: adapter.stream.open }
    observations.push(observation)
    return {
      ...adapter,
      rpc: (...args) => observation.rpc(...args),
      stream: { ...adapter.stream, open: (...args) => observation.open(...args) },
    }
  })
  let scaffold: WebScaffold
  try {
    scaffold = await launchWebScaffold(options)
  } finally {
    spy.mockRestore()
  }
  if (observations.length !== 1) {
    await scaffold.close()
    throw new Error(`Native scenario requires one listener, received ${observations.length}`)
  }
  return { ...scaffold, nativeGateway: observations[0]! }
}
