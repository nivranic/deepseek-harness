/** §28 switch window: one observable stream across retarget, retirement, and re-establishment. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  apply,
  type ConnectionGenerationSource,
  type ConnectionState,
  type ConnectionHandle,
} from '../src/client/index.ts'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'

const A_ORIGIN = 'https://host-a.local:8787'
const B_ORIGIN = 'https://host-b.local'

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

interface SwitchSample {
  readonly target: string | undefined
  readonly hostId: string | undefined
  readonly state: ConnectionState | undefined
}

interface Gate {
  readonly promise: Promise<void>
  open: () => void
}

/**
 * Mount the real Connection plugin with one gated, origin-reading generation
 * source: each attempt records the origin it was addressed to and parks
 * before readiness until the test releases that origin's gate.
 */
async function mountSwitch() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    configurable: true, value: { hostname: 'page.local', search: '', origin: 'https://page.local' },
  })
  onTestFinished(() => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'location')
    else Object.defineProperty(globalThis, 'location', previous)
  })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin({ apply, inject: [] }).await()
  const connection = ctx.get('connection') as ConnectionHandle

  const gates = new Map<string, Gate>()
  const resolvedGate = (): Gate => ({ promise: Promise.resolve(), open: () => {} })
  gates.set(A_ORIGIN, resolvedGate())
  /** Park the next generation on this origin until {@link releaseGate} opens it. */
  const holdOrigin = (origin: string): void => {
    let open!: () => void
    const promise = new Promise<void>((resolve) => { open = resolve })
    gates.set(origin, { promise, open })
  }
  const releaseGate = (origin: string): void => { gates.get(origin)?.open() }

  let selectedOrigin: string | undefined
  const attempts: string[] = []
  const source: ConnectionGenerationSource = (signal, ready) => {
    const origin = selectedOrigin ?? 'page'
    attempts.push(origin)
    const gate = gates.get(origin)
    const establish = async (): Promise<void> => {
      await (gate?.promise ?? Promise.resolve())
      signal.throwIfAborted()
      const onB = origin === B_ORIGIN
      ready({
        home: onB ? '/home/b' : '/home/a',
        platform: 'win32',
        descriptor: descriptorOf(
          onB ? 'bbbb0000-0000-0000-0000-00000000000b' : 'aaaa0000-0000-0000-0000-00000000000a',
          onB ? 'Host B' : 'Host A',
        ),
      })
      return new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    return establish()
  }
  connection.registerGenerationSource(source)

  const samples: SwitchSample[] = []
  const sample = (): void => {
    samples.push({
      target: connection.target.getSnapshot(),
      hostId: connection.generation.getSnapshot()?.host.descriptor?.hostId,
      state: connection.state.getSnapshot(),
    })
  }
  const stopTarget = connection.target.subscribe(sample)
  const stopGeneration = connection.generation.subscribe(sample)
  const stopState = connection.state.subscribe(sample)
  onTestFinished(() => { stopTarget(); stopGeneration(); stopState() })

  const select = (origin: string | undefined): void => {
    selectedOrigin = origin
    connection.retarget(origin)
  }
  return { connection, select, holdOrigin, releaseGate, attempts, samples }
}

function start(connection: ConnectionHandle) {
  const loop = connection.start({}, {
    backoffBaseMs: 1, backoffFactor: 2, backoffMaxMs: 8, generationReadyTimeoutMs: 5000,
  })
  onTestFinished(() => { loop.stop() })
  return loop
}

describe('host switch window', () => {
  it('retires the old generation and parks the composer inputs before any observation of the new target', async () => {
    const { connection, select, holdOrigin, releaseGate, attempts, samples } = await mountSwitch()
    holdOrigin(B_ORIGIN)
    select(A_ORIGIN)
    start(connection)
    await vi.waitFor(() => { expect(connection.state.getSnapshot()).toBe('ready') })
    expect(connection.generation.getSnapshot()?.host.descriptor?.displayName).toBe('Host A')
    expect(connection.target.getSnapshot()).toBe(A_ORIGIN)

    select(B_ORIGIN)
    // The switch seam is synchronous: routing authority flips and the A generation
    // is retired inside the retarget call, so no observer can pair the new target
    // with the retired Host's facts (§28 forbids showing B while still on A).
    expect(connection.target.getSnapshot()).toBe(B_ORIGIN)
    expect(connection.generation.getSnapshot()).toBeUndefined()
    expect(connection.state.getSnapshot()).toBe('reconnecting')

    await vi.waitFor(() => { expect(attempts).toEqual([A_ORIGIN, B_ORIGIN]) })
    // Switch window: the two composer inputs — capability facts and recovery
    // state — both sit in their refusing shape while B has not established.
    expect(connection.generation.getSnapshot()).toBeUndefined()
    expect(connection.state.getSnapshot()).not.toBe('ready')
    // Once the switch began, no further attempt is addressed to A.
    expect(attempts.filter(origin => origin === A_ORIGIN)).toHaveLength(1)

    releaseGate(B_ORIGIN)
    await vi.waitFor(() => { expect(connection.state.getSnapshot()).toBe('ready') })
    const established = connection.generation.getSnapshot()
    expect(established?.host.descriptor?.displayName).toBe('Host B')
    expect(established?.host.home).toBe('/home/b')
    expect(connection.target.getSnapshot()).toBe(B_ORIGIN)

    // Display and routing agree on B: the roster's current row is the one the
    // selected origin points at, and each row recorded its own origin.
    const rows = connection.savedHosts.list()
    expect(rows.map(row => row.displayName)).toEqual(['Host B', 'Host A'])
    expect(rows.find(row => row.displayName === 'Host A')?.origin).toBe(A_ORIGIN)
    expect(rows.find(row => row.origin === connection.target.getSnapshot())?.displayName).toBe('Host B')

    // Every flush of any of the three observables keeps the §28 invariant:
    // never the new target with A's generation, never B's generation while
    // routing elsewhere, and the switch window itself was observable.
    expect(samples.some(entry => entry.target === B_ORIGIN && entry.hostId?.startsWith('aaaa'))).toBe(false)
    expect(samples.some(entry => entry.hostId?.startsWith('bbbb') && entry.target !== B_ORIGIN)).toBe(false)
    expect(samples.some(entry => entry.target === B_ORIGIN && entry.hostId === undefined)).toBe(true)
  })
})
