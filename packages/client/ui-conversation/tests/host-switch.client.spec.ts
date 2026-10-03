/** §28 switch window at the composer control source: gateway-shaped Host facts refuse input mid-switch. */
import { describe, expect, it, vi } from 'vitest'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHostInfo } from '@deepseek-ai/dsh-client-connection/client'
import { createComposerControlSource } from '../src/client/input/control-capabilities.ts'

type HostDescriptor = NonNullable<ConnectionHostInfo['descriptor']>

function descriptorOf(hostId: string, displayName: string): HostDescriptor {
  return {
    hostId: hostId as HostDescriptor['hostId'],
    displayName,
    productVersion: '0.0.0-fixture',
    apiProtocolVersion: 1,
    sessionFormatVersion: 3,
    platform: 'win32',
    arch: 'x64',
    runtimeMode: 'full',
    capabilities: ['host.describe.v1', 'session.control.v1', 'session.cancel-turn.v1', 'file-upload.stage.v1'],
    transports: ['websocket'],
    serverTime: 0,
  }
}

/**
 * Host A facts as the api-gateway `$host` getter builds them from one ready
 * generation: descriptor and capabilities spread from the generation's Host
 * info. Host B drops file upload so the post-switch snapshot provably follows
 * the new generation instead of stale A facts.
 */
const HOST_A: RemoteHostFacts = {
  home: '/home/a', platform: 'win32', isLoopback: false,
  descriptor: descriptorOf('aaaa0000-0000-0000-0000-00000000000a', 'Host A'),
  capabilities: ['host.describe.v1', 'session.control.v1', 'session.cancel-turn.v1', 'file-upload.stage.v1'],
}

/**
 * The mid-switch facts the same getter returns while no generation is
 * established: a stable shell with no capabilities at all, so every
 * capability probe answers false for the whole switch window.
 */
const MID_SWITCH_SHELL: RemoteHostFacts = { home: undefined, platform: undefined, isLoopback: false }

const HOST_B: RemoteHostFacts = {
  home: '/home/b', platform: 'linux', isLoopback: false,
  descriptor: descriptorOf('bbbb0000-0000-0000-0000-00000000000b', 'Host B'),
  capabilities: ['host.describe.v1', 'session.control.v1', 'session.cancel-turn.v1'],
}

function bench(initial: RemoteHostFacts) {
  let host = initial
  const listeners = new Set<() => void>()
  const cancel = vi.fn(() => Promise.resolve())
  const source = createComposerControlSource({
    host: () => host,
    address: () => undefined,
    alive: () => true,
    cancel,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
  /** Swap Host facts the way a generation retirement then establishment does. */
  const transition = (next: RemoteHostFacts): void => {
    host = next
    for (const listener of [...listeners]) listener()
  }
  return { source, transition, cancel, listeners }
}

describe('composer control across a host switch', () => {
  it('admits on A, refuses through the mid-switch shell, and re-admits only on B facts', () => {
    const b = bench(HOST_A)
    const onA = b.source.getSnapshot()
    expect(onA).toMatchObject({ prompt: true, interrupt: true, steer: false, fileUpload: true })

    b.transition(MID_SWITCH_SHELL)
    const midSwitch = b.source.getSnapshot()
    expect(midSwitch).toMatchObject({ prompt: false, interrupt: false, steer: false, fileUpload: false })
    expect(onA.current()).toBe(false)

    b.transition(HOST_B)
    const onB = b.source.getSnapshot()
    expect(onB).toMatchObject({ prompt: true, interrupt: true, steer: false })
    // B's own facts decide: it does not advertise upload, and the retained
    // A snapshot stopped being current the moment the generation moved.
    expect(onB.fileUpload).toBe(false)
    expect(onA.fileUpload).toBe(true)
    expect(onA.current()).toBe(false)
    expect(onB.current()).toBe(true)
  })

  it('recomputes per generation flush and keeps snapshot identity between flushes', () => {
    const b = bench(HOST_A)
    const listener = vi.fn()
    const dispose = b.source.subscribe(listener)
    expect(b.source.getSnapshot()).toBe(b.source.getSnapshot())

    b.transition(MID_SWITCH_SHELL)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(b.source.getSnapshot().prompt).toBe(false)
    b.transition(HOST_B)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(b.source.getSnapshot().prompt).toBe(true)

    dispose()
    expect(b.listeners.size).toBe(0)
  })
})
