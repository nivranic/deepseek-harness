/** Connection generation readiness, loss, retry, and sink isolation. */

import { describe, expect, it, vi } from 'vitest'
import type { ConnectionGenerationSource, ConnectionState } from '../src/client/connection.ts'
import { ConnectionController } from '../src/client/connection.ts'
import { FakeGenerationSource } from './fake-generation.client.ts'

const FAST = { backoffBaseMs: 10, backoffFactor: 1, backoffMaxMs: 10, generationReadyTimeoutMs: 500 }

describe('connection lifecycle', () => {
  it('captures readiness and waits for aborted source work before reporting stopped', async () => {
    let ready: (() => void) | undefined
    let finish: (() => void) | undefined
    const source: ConnectionGenerationSource = (_signal, opened) => new Promise<void>((resolve) => {
      ready = () => { opened({ home: '/private-host-home' }) }
      finish = resolve
    })
    const controller = new ConnectionController(source, {}, FAST)
    const idle = controller.diagnosticSnapshot()
    expect(idle).toEqual({ state: 'idle', attempts: 0, interruptions: 0, countsSaturated: false })
    controller.start()
    const opening = controller.diagnosticSnapshot()
    expect(opening).toEqual({ ...idle, state: 'opening', attempts: 1 })
    try {
      await vi.waitFor(() => { expect(ready).toBeDefined() })
      ready!()
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('connected') })
      controller.stop()
      expect(controller.diagnosticSnapshot().state).toBe('stopping')
      finish!()
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('stopped') })
      expect(controller.diagnosticSnapshot()).toEqual({ ...opening, state: 'stopped' })
      expect(idle.state).toBe('idle')
      expect(opening.state).toBe('opening')
      expect(JSON.stringify(controller.diagnosticSnapshot())).not.toContain('private')
    } finally { controller.stop(); finish?.() }
  })

  it('cancels a retry delay when stopped and retains the settled interruption count', async () => {
    const source = new FakeGenerationSource()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(source.source, {}, { ...FAST, backoffBaseMs: 10_000, backoffMaxMs: 10_000 })
    controller.start()
    try {
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('connected') })
      source.end()
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot()).toEqual({ state: 'reconnecting', attempts: 1, interruptions: 1, countsSaturated: false }) })
      controller.stop()
      // A live backoff would take at least five seconds; cancellation settles it within this ordinary wait.
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('stopped') })
      expect(controller.diagnosticSnapshot().attempts).toBe(1)
    } finally { controller.stop(); warning.mockRestore() }
  })

  it('does not let a retired loop restart after a replacement is connected', async () => {
    const finishes: Array<() => void> = []
    const source: ConnectionGenerationSource = (_signal, ready) => new Promise<void>((resolve) => {
      finishes.push(resolve)
      ready({ home: '/private-host-home' })
    })
    const controller = new ConnectionController(source, {}, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('connected') })
      controller.stop()
      controller.start()
      await vi.waitFor(() => { expect(finishes).toHaveLength(2) })
      finishes[0]!()
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(finishes).toHaveLength(2)
      expect(controller.diagnosticSnapshot()).toEqual({ state: 'connected', attempts: 2, interruptions: 0, countsSaturated: false })
      controller.stop()
      expect(controller.diagnosticSnapshot().state).toBe('stopping')
      finishes[1]!()
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('stopped') })
    } finally { controller.stop(); for (const finish of finishes) finish() }
  })

  it('does not invoke a source when its owner stops before deferred startup', async () => {
    const source = vi.fn<ConnectionGenerationSource>(() => Promise.resolve())
    const controller = new ConnectionController(source, {}, FAST)
    controller.start()
    controller.stop()
    await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('stopped') })
    expect(source).not.toHaveBeenCalled()
    expect(controller.diagnosticSnapshot().interruptions).toBe(0)
  })

  it('reports a readiness timeout while the aborted source is still settling', async () => {
    let signal: AbortSignal | undefined
    let finish: (() => void) | undefined
    const source: ConnectionGenerationSource = received => new Promise<void>((resolve) => {
      signal = received
      finish = resolve
    })
    const controller = new ConnectionController(source, {}, { ...FAST, generationReadyTimeoutMs: 5 })
    controller.start()
    try {
      await vi.waitFor(() => { expect(signal?.aborted).toBe(true) })
      expect(controller.diagnosticSnapshot()).toEqual({ state: 'reconnecting', attempts: 1, interruptions: 0, countsSaturated: false })
      controller.stop()
      finish!()
      await vi.waitFor(() => { expect(controller.diagnosticSnapshot().state).toBe('stopped') })
    } finally { controller.stop(); finish?.() }
  })

  it('bounds lifetime counters without serializing Host facts', () => {
    const controller = new ConnectionController(() => Promise.resolve())
    // Advance lifetime counters to their wire limit without billions of transport operations.
    Object.assign(controller, { generation: 0x1_0000_0000, interruptions: 0xffff_ffff })
    expect(controller.diagnosticSnapshot()).toEqual({ state: 'stopped', attempts: 0xffff_ffff, interruptions: 0xffff_ffff, countsSaturated: true })
  })

  it('announces connected with the Host facts from generation readiness', async () => {
    const source = new FakeGenerationSource()
    const homes: string[] = []
    const controller = new ConnectionController(source.source, {
      onConnected: (host) => { homes.push(host.home) },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(homes).toEqual(['/h']) })
    } finally {
      controller.stop()
    }
  })

  it('reconnects with a fresh generation when its source fails, and stop() ends the loop', async () => {
    const source = new FakeGenerationSource()
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(source.source, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      source.fail(new Error('stream torn'))
      await vi.waitFor(() => { expect(connected).toBe(2) })
      expect(source.activeCount).toBe(1)
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
    await vi.waitFor(() => { expect(source.activeCount).toBe(0) })
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(source.activeCount).toBe(0)
  })

  it('isolates a connected sink exception from the generation', async () => {
    const source = new FakeGenerationSource()
    let connected = 0
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = new ConnectionController(source.source, {
      onConnected: () => {
        connected++
        throw new Error('business layer bug')
      },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(source.activeCount).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith('[connection] connection sink threw:', expect.any(Error))
    } finally {
      controller.stop()
      errorSpy.mockRestore()
    }
  })

  it('holds onConnected until the incremental source reports ready', async () => {
    const source = new FakeGenerationSource()
    source.holdReady = true
    let connected = 0
    const controller = new ConnectionController(source.source, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(source.activeCount).toBe(1) })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(connected).toBe(0)
      source.releaseReady()
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
    }
  })

  it('accepts only the first readiness report from one generation', async () => {
    const homes: string[] = []
    const source: ConnectionGenerationSource = (signal, ready) => {
      ready({ home: '/first' })
      ready({ home: '/duplicate' })
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    const controller = new ConnectionController(source, {
      onConnected: (host) => { homes.push(host.home) },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(homes).toEqual(['/first']) })
    } finally {
      controller.stop()
    }
  })

  it('does not announce readiness after a stop queued from the ready callback', async () => {
    const owner: { controller?: ConnectionController } = {}
    let sourceCalls = 0
    const connected = vi.fn()
    const source: ConnectionGenerationSource = (signal, ready) => new Promise<void>((resolve) => {
      sourceCalls++
      ready({ home: '/h' })
      queueMicrotask(() => { owner.controller?.stop() })
      signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
    const controller = new ConnectionController(source, { onConnected: connected }, FAST)
    owner.controller = controller
    controller.start()
    await vi.waitFor(() => { expect(sourceCalls).toBe(1) })
    expect(connected).not.toHaveBeenCalled()
  })

  it('rejects a generation whose source ends during readiness and retries', async () => {
    const source = new FakeGenerationSource()
    source.holdReady = true
    const states: ConnectionState[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(source.source, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(source.activeCount).toBe(1) })
      source.holdReady = false
      source.end()
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it.each([
    { label: 'ends normally', fail: () => Promise.resolve() },
    {
      label: 'rejects with a non-Error reason',
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario under test
      fail: () => Promise.reject('fixture offline'),
    },
  ])('retries when the generation source $label before reporting ready', async ({ fail }) => {
    let sourceCalls = 0
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const source: ConnectionGenerationSource = (signal, ready) => {
      sourceCalls++
      if (sourceCalls === 1) return fail()
      ready({ home: '/h' })
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    const controller = new ConnectionController(source, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(sourceCalls).toBe(2) })
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('rejects and retries a generation whose source never reports ready', async () => {
    const source = new FakeGenerationSource()
    source.suppressReady = true
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(
      source.source,
      { onConnected: () => { connected++ } },
      { ...FAST, generationReadyTimeoutMs: 20 },
    )
    controller.start()
    try {
      await vi.waitFor(() => { expect(source.activeCount).toBeGreaterThan(0) })
      await new Promise(resolve => setTimeout(resolve, 45))
      expect(connected).toBe(0)
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('emits deduplicated connected/reconnecting state transitions', async () => {
    const source = new FakeGenerationSource()
    const states: ConnectionState[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(source.source, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['connected'])
      source.fail(new Error('torn'))
      await vi.waitFor(() => { expect(connected).toBe(2) })
      expect(states).toEqual(['connected', 'reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('does not announce a generation stopped synchronously by its connected state sink', async () => {
    const source = new FakeGenerationSource()
    const states: ConnectionState[] = []
    let connected = 0
    const controller = new ConnectionController(source.source, {
      onConnected: () => { connected++ },
      onStateChange: (state) => {
        states.push(state)
        if (state === 'connected') controller.stop()
      },
    }, FAST)

    controller.start()
    await vi.waitFor(() => { expect(states).toEqual(['connected']) })
    await vi.waitFor(() => { expect(source.activeCount).toBe(0) })
    expect(connected).toBe(0)
  })

  it('deduplicates consecutive reconnecting emissions across two straight failures', async () => {
    let sourceCalls = 0
    const states: ConnectionState[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const source: ConnectionGenerationSource = (signal, ready) => {
      sourceCalls++
      if (sourceCalls <= 2) return Promise.reject(new Error('down'))
      ready({ home: '/h' })
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    const controller = new ConnectionController(source, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(sourceCalls).toBe(3) })
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('runs with no sinks at all', async () => {
    const source = new FakeGenerationSource()
    const controller = new ConnectionController(source.source, {}, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(source.activeCount).toBe(1) })
    } finally {
      controller.stop()
    }
  })

  it('start() is idempotent', async () => {
    const source = new FakeGenerationSource()
    let connected = 0
    const controller = new ConnectionController(source.source, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(source.activeCount).toBe(1)
    } finally {
      controller.stop()
    }
  })
})
